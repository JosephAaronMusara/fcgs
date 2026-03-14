import nodemailer from "nodemailer";
import { db } from "./db";
import { communicationLogs } from "@shared/schema";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

export interface EconetSmsConfig {
  domain: string;
  apiKey: string;
  senderId: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  schoolId?: number;
  recipientType?: string;
  recipientId?: number;
  recipientName?: string;
  category?: string;
  sentBy?: number;
}

export interface SendSmsParams {
  to: string;
  message: string;
  schoolId?: number;
  recipientType?: string;
  recipientId?: number;
  recipientName?: string;
  category?: string;
  sentBy?: number;
}

/**
 * Normalize Zimbabwe phone numbers to Econet format: 2637XXXXXXXX
 * Accepts: 07..., +2637..., 2637..., 7XXXXXXXX
 */
function normalizeZimbabwePhone(phone: string): string {
  let p = phone.replace(/\D+/g, '');
  if (!p) return '';

  // 07xxxxxxxx -> 2637xxxxxxxx
  if (p.startsWith('0')) {
    p = '263' + p.substring(1);
  }

  // already 263...
  if (p.startsWith('263')) {
    return p;
  }

  // 7xxxxxxxx -> 2637xxxxxxxx
  if (p.startsWith('7') && p.length >= 9) {
    return '263' + p;
  }

  return '';
}

/**
 * Parse Econet gateway response (XML or JSON)
 */
function parseEconetResponse(body: string): { ok: boolean; code: string; desc: string; raw: string } {
  const trim = body.trim();
  const out = {
    ok: false,
    code: '',
    desc: '',
    raw: body,
  };

  if (!trim) {
    out.desc = 'Empty response body';
    return out;
  }

  // Try JSON first
  if (trim.startsWith('{') || trim.startsWith('[')) {
    try {
      const j = JSON.parse(trim);
      const status = j.status || {};
      const code = status['error-code'] || status['error_code'] || '';
      const desc = status['error-description'] || status['error_description'] || '';
      out.code = String(code);
      out.desc = String(desc);
      out.ok = String(code) === '000';
      return out;
    } catch {
      // Not valid JSON, try XML
    }
  }

  // Try XML parsing
  // Simple XML parsing for Econet response
  const codeMatch = trim.match(/<error-code>([^<]*)<\/error-code>/);
  const descMatch = trim.match(/<error-description>([^<]*)<\/error-description>/);
  
  if (codeMatch) {
    out.code = codeMatch[1];
    out.desc = descMatch ? descMatch[1] : '';
    out.ok = out.code === '000';
    return out;
  }

  out.desc = 'Unrecognized response (not JSON/XML)';
  return out;
}

class CommunicationService {
  private emailTransporter: nodemailer.Transporter | null = null;
  private emailConfig: EmailConfig | null = null;
  private smsConfig: EconetSmsConfig | null = null;
  private _communicationsDisabled: boolean = false;

  get communicationsDisabled(): boolean {
    return this._communicationsDisabled;
  }

  setCommunicationsDisabled(disabled: boolean) {
    this._communicationsDisabled = disabled;
  }

  configureEmail(config: EmailConfig) {
    this.emailConfig = config;
    this.emailTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  configureSms(config: EconetSmsConfig) {
    this.smsConfig = config;
  }

  isEmailConfigured(): boolean {
    return this.emailTransporter !== null && this.emailConfig !== null;
  }

  isSmsConfigured(): boolean {
    return this.smsConfig !== null;
  }

  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string; logId?: number }> {
    if (this._communicationsDisabled) {
      return { success: false, error: "All communication channels are currently disabled by the IT Administrator." };
    }

    const logEntry = {
      schoolId: params.schoolId,
      channel: "email" as const,
      recipientType: params.recipientType || "unknown",
      recipientId: params.recipientId,
      recipientEmail: params.to,
      recipientName: params.recipientName,
      subject: params.subject,
      message: params.html || params.text || "",
      category: params.category,
      status: "pending" as const,
      sentBy: params.sentBy,
    };

    try {
      if (!this.emailTransporter || !this.emailConfig) {
        const [log] = await db.insert(communicationLogs).values({
          ...logEntry,
          status: "failed",
          errorMessage: "Email not configured. Please configure SMTP settings.",
        }).returning();
        return { success: false, error: "Email not configured", logId: log.id };
      }

      const mailOptions: any = {
        from: this.emailConfig.from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      };
      if (params.attachments && params.attachments.length > 0) {
        mailOptions.attachments = params.attachments.map(a => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || 'application/pdf',
        }));
      }
      await this.emailTransporter.sendMail(mailOptions);

      const [log] = await db.insert(communicationLogs).values({
        ...logEntry,
        status: "sent",
        sentAt: new Date(),
      }).returning();

      this._createNotificationForRecipient(params.recipientType, params.recipientId, params.subject || "New Email", params.text || params.html || "", "email", params.schoolId, params.sentBy);

      return { success: true, logId: log.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const [log] = await db.insert(communicationLogs).values({
        ...logEntry,
        status: "failed",
        errorMessage,
      }).returning();
      return { success: false, error: errorMessage, logId: log.id };
    }
  }

  async sendSms(params: SendSmsParams): Promise<{ success: boolean; error?: string; logId?: number }> {
    if (this._communicationsDisabled) {
      return { success: false, error: "All communication channels are currently disabled by the IT Administrator." };
    }

    const logEntry = {
      schoolId: params.schoolId,
      channel: "sms" as const,
      recipientType: params.recipientType || "unknown",
      recipientId: params.recipientId,
      recipientPhone: params.to,
      recipientName: params.recipientName,
      message: params.message,
      category: params.category,
      status: "pending" as const,
      sentBy: params.sentBy,
    };

    try {
      if (!this.smsConfig) {
        const [log] = await db.insert(communicationLogs).values({
          ...logEntry,
          status: "failed",
          errorMessage: "SMS not configured. Please configure Econet SMS settings.",
        }).returning();
        return { success: false, error: "SMS not configured", logId: log.id };
      }

      // Normalize Zimbabwe phone number
      const msisdn = normalizeZimbabwePhone(params.to);
      if (!msisdn) {
        const [log] = await db.insert(communicationLogs).values({
          ...logEntry,
          status: "failed",
          errorMessage: `Invalid/empty phone format: ${params.to}`,
        }).returning();
        return { success: false, error: `Invalid phone format: ${params.to}`, logId: log.id };
      }

      // Build Econet API URL with query parameters
      const endpoint = `https://${this.smsConfig.domain}/client/api/sendmessage`;
      const queryParams = new URLSearchParams({
        apikey: this.smsConfig.apiKey,
        mobiles: msisdn,
        sms: params.message,
        senderid: this.smsConfig.senderId,
        schedule: 'no',
        'sending-time': '',
        unicode: 'no',
        'client-sms-ids': `fcgs_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      });

      const url = `${endpoint}?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, application/xml, text/xml, */*',
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} from gateway. Body: ${body}`);
      }

      const body = await response.text();
      const parsed = parseEconetResponse(body);

      if (!parsed.ok) {
        const errorMsg = `Econet error-code=${parsed.code || '(blank)'} desc=${parsed.desc || '(blank)'}`;
        console.error(`[FCGS SMS] Failed msisdn=${msisdn} :: ${errorMsg} :: raw=${parsed.raw}`);
        
        const [log] = await db.insert(communicationLogs).values({
          ...logEntry,
          recipientPhone: msisdn,
          status: "failed",
          errorMessage: errorMsg,
        }).returning();
        return { success: false, error: errorMsg, logId: log.id };
      }

      const [log] = await db.insert(communicationLogs).values({
        ...logEntry,
        recipientPhone: msisdn,
        status: "sent",
        sentAt: new Date(),
      }).returning();

      this._createNotificationForRecipient(params.recipientType, params.recipientId, "New SMS", params.message, "sms", params.schoolId, params.sentBy);

      return { success: true, logId: log.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[FCGS SMS] ${errorMessage}`);
      const [log] = await db.insert(communicationLogs).values({
        ...logEntry,
        status: "failed",
        errorMessage,
      }).returning();
      return { success: false, error: errorMessage, logId: log.id };
    }
  }

  async sendBulkEmail(recipients: Array<{ email: string; name?: string; id?: number }>, subject: string, message: string, options?: {
    schoolId?: number;
    recipientType?: string;
    sentBy?: number;
    category?: string;
  }): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const recipient of recipients) {
      const result = await this.sendEmail({
        to: recipient.email,
        subject,
        html: message,
        schoolId: options?.schoolId,
        recipientType: options?.recipientType,
        recipientId: recipient.id,
        recipientName: recipient.name,
        sentBy: options?.sentBy,
        category: options?.category,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`${recipient.email}: ${result.error}`);
        }
      }
    }

    return { sent, failed, errors };
  }

  async sendBulkSms(recipients: Array<{ phone: string; name?: string; id?: number }>, message: string, options?: {
    schoolId?: number;
    recipientType?: string;
    sentBy?: number;
    category?: string;
  }): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const recipient of recipients) {
      const result = await this.sendSms({
        to: recipient.phone,
        message,
        schoolId: options?.schoolId,
        recipientType: options?.recipientType,
        recipientId: recipient.id,
        recipientName: recipient.name,
        sentBy: options?.sentBy,
        category: options?.category,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        if (result.error) {
          errors.push(`${recipient.phone}: ${result.error}`);
        }
      }
    }

    return { sent, failed, errors };
  }

  private async _createNotificationForRecipient(
    recipientType?: string,
    recipientId?: number,
    title?: string,
    message?: string,
    channel?: string,
    schoolId?: number,
    sentBy?: number,
  ) {
    if (!recipientType || !recipientId || !title || !message) return;
    try {
      const { notifications, staff, students, parents } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      let table: any;
      if (recipientType === "staff") table = staff;
      else if (recipientType === "student") table = students;
      else if (recipientType === "parent") table = parents;
      else return;

      const [record] = await db.select({ userId: table.userId, schoolId: table.schoolId })
        .from(table)
        .where(eq(table.id, recipientId))
        .limit(1);

      if (!record?.userId) return;

      const plainMsg = message.replace(/<[^>]*>/g, '');

      await db.insert(notifications).values({
        userId: record.userId,
        schoolId: schoolId || record.schoolId || undefined,
        type: "communication",
        title,
        message: plainMsg.length > 500 ? plainMsg.substring(0, 497) + "..." : plainMsg,
        channel: channel || "system",
        severity: "info",
        actorUserId: sentBy,
      });
    } catch (error) {
      console.error("[Notifications] Failed to create notification for recipient:", error);
    }
  }
}

export const communicationService = new CommunicationService();

export async function createInAppNotifications(params: {
  recipientType: string;
  recipientIds: number[];
  title: string;
  message: string;
  channel: string;
  schoolId?: number;
  actorUserId?: number;
  link?: string;
  severity?: string;
}) {
  try {
    const { notifications, staff, students, parents } = await import("@shared/schema");
    let table: any;
    if (params.recipientType === "staff") table = staff;
    else if (params.recipientType === "student") table = students;
    else if (params.recipientType === "parent") table = parents;
    else return;

    const { inArray } = await import("drizzle-orm");
    const records = await db.select({ id: table.id, userId: table.userId, schoolId: table.schoolId })
      .from(table)
      .where(inArray(table.id, params.recipientIds));

    const notifValues = records
      .filter((r: any) => r.userId != null)
      .map((r: any) => ({
        userId: r.userId!,
        schoolId: params.schoolId || r.schoolId || undefined,
        type: "communication",
        title: params.title,
        message: params.message.length > 500 ? params.message.substring(0, 497) + "..." : params.message,
        channel: params.channel,
        severity: params.severity || "info",
        link: params.link,
        actorUserId: params.actorUserId,
      }));

    if (notifValues.length > 0) {
      await db.insert(notifications).values(notifValues);
    }
  } catch (error) {
    console.error("[Notifications] Failed to create in-app notifications:", error);
  }
}

export async function createBroadcastNotifications(params: {
  schoolId: number;
  targetAudience: string;
  title: string;
  message: string;
  channel: string;
  actorUserId?: number;
  link?: string;
}) {
  try {
    const { notifications, users } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const schoolUsers = await db.select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.schoolId, params.schoolId), eq(users.isActive, true)));

    let targetUsers = schoolUsers;
    if (params.targetAudience === "staff") {
      targetUsers = schoolUsers.filter(u => !["student", "parent"].includes(u.role));
    } else if (params.targetAudience === "students") {
      targetUsers = schoolUsers.filter(u => u.role === "student");
    } else if (params.targetAudience === "parents") {
      targetUsers = schoolUsers.filter(u => u.role === "parent");
    }

    const notifValues = targetUsers.map(u => ({
      userId: u.id,
      schoolId: params.schoolId,
      type: "newsletter",
      title: params.title,
      message: params.message.length > 500 ? params.message.substring(0, 497) + "..." : params.message,
      channel: params.channel,
      severity: "info" as const,
      link: params.link,
      actorUserId: params.actorUserId,
    }));

    if (notifValues.length > 0) {
      await db.insert(notifications).values(notifValues);
    }
  } catch (error) {
    console.error("[Notifications] Failed to create broadcast notifications:", error);
  }
}

export function initializeCommunication() {
  // Configure Email (SMTP)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    communicationService.configureEmail({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      from: process.env.SMTP_FROM || "noreply@firstchoicegroup.co.zw",
    });
    console.log("Email service configured");
  }

  // Configure SMS (Econet Gateway)
  if (process.env.ECONET_SMS_APIKEY) {
    communicationService.configureSms({
      domain: process.env.ECONET_SMS_DOMAIN || 'mobilemessaging.econet.co.zw',
      apiKey: process.env.ECONET_SMS_APIKEY,
      senderId: process.env.ECONET_SMS_SENDERID || 'First Choice',
    });
    console.log("SMS service configured (Econet)");
  }
}

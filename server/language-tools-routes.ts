import type { Express, Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAuth, requirePermission } from "./auth";
import { languageToolSettings, schools } from "@shared/schema";

const DEFAULTS = {
  enabled: true,
  primaryProvider: null as string | null,
  fallbackProvider: "harper" as string | null,
  mode: "balanced" as const,
  dialect: "en-GB" as const,
  studentNamePersonalization: true,
  genderPronounCheck: true,
};

const updateSchema = z.object({
  enabled: z.boolean(),
  primaryProvider: z.string().trim().min(1).nullable(),
  fallbackProvider: z.string().trim().min(1).nullable(),
  mode: z.enum(["review_all", "balanced", "auto_apply_safe"]),
  dialect: z.literal("en-GB"),
  studentNamePersonalization: z.boolean(),
  genderPronounCheck: z.boolean(),
});

async function resolveOrganizationId(req: Request): Promise<number | null> {
  const user = req.user as any;
  const direct = Number(user?.organizationId || 0);
  if (direct > 0) return direct;
  const schoolId = Number(user?.schoolId || req.headers["x-school-id"] || 0);
  if (!schoolId) return null;
  const [school] = await db.select({ organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return school?.organizationId ?? null;
}

function publicSettings(row: any) {
  return {
    enabled: row?.enabled ?? DEFAULTS.enabled,
    primaryProvider: row?.primaryProvider ?? DEFAULTS.primaryProvider,
    fallbackProvider: row?.fallbackProvider ?? DEFAULTS.fallbackProvider,
    mode: row?.mode ?? DEFAULTS.mode,
    dialect: row?.dialect === "en-GB" ? "en-GB" : DEFAULTS.dialect,
    studentNamePersonalization: row?.studentNamePersonalization ?? DEFAULTS.studentNamePersonalization,
    genderPronounCheck: row?.genderPronounCheck ?? DEFAULTS.genderPronounCheck,
  };
}

export function registerLanguageToolsRoutes(app: Express) {
  app.get("/api/language-tools/settings", requireAuth, async (req, res, next) => {
    try {
      const organizationId = await resolveOrganizationId(req);
      if (!organizationId) return res.json(DEFAULTS);
      const [row] = await db.select().from(languageToolSettings).where(eq(languageToolSettings.organizationId, organizationId)).limit(1);
      res.json(publicSettings(row));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/language-tools/settings", requireAuth, requirePermission("settings.edit"), async (req, res, next) => {
    try {
      const organizationId = await resolveOrganizationId(req);
      if (!organizationId) return res.status(400).json({ message: "Organization context is required" });
      const input = updateSchema.parse(req.body);
      const values = {
        organizationId,
        ...input,
        createdByUserId: (req.user as any)?.id ?? null,
        updatedAt: new Date(),
      };
      const [saved] = await db.insert(languageToolSettings).values(values).onConflictDoUpdate({
        target: languageToolSettings.organizationId,
        set: {
          ...input,
          updatedAt: new Date(),
        },
      }).returning();
      res.json(publicSettings(saved));
    } catch (error) {
      next(error);
    }
  });
}

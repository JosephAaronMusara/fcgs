import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { User } from "@shared/schema";

type PermissionRequirement = string | string[];

const MemoryStore = createMemoryStore(session);

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      password: string;
      email: string | null;
      role: "org_admin" | "school_admin" | "teacher" | "quality_control_officer" | "assistant_teacher" | "librarian" | "student" | "parent";
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      createdAt: Date | null;
      organizationId: number | null;
      schoolId: number | null;
      isActive: boolean | null;
      passwordResetToken: string | null;
      passwordResetTokenExpiry: Date | null;
      tempPasswordLoginsRemaining: number | null;
      mustResetPassword: boolean | null;
    }
  }
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function comparePasswords(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}


const STAFF_LOGIN_ROLES = new Set([
  "school_admin",
  "teacher",
  "assistant_teacher",
  "quality_control_officer",
  "librarian",
]);

const LEGACY_ROUTE_PERMISSION_RULES: Array<{
  method?: string;
  pattern: RegExp;
  requirement: PermissionRequirement;
}> = [
  { method: "GET", pattern: /^\/api\/users$/, requirement: "users.view" },
  { method: "PUT", pattern: /^\/api\/users\/\d+$/, requirement: "users.edit" },
  { method: "DELETE", pattern: /^\/api\/users\/\d+$/, requirement: "users.delete" },
  { method: "GET", pattern: /^\/api\/users\/\d+\/schools$/, requirement: "users.view" },
  { method: "PUT", pattern: /^\/api\/users\/\d+\/permissions$/, requirement: "users.manage_permissions" },
  { method: "PUT", pattern: /^\/api\/users\/\d+\/password$/, requirement: "users.manage_permissions" },
  { method: "PUT", pattern: /^\/api\/users\/\d+\/status$/, requirement: "users.manage_permissions" },
  { method: "GET", pattern: /^\/api\/search$/, requirement: "users.view" },

  { method: "POST", pattern: /^\/api\/staff$/, requirement: "staff.create" },
  { method: "PUT", pattern: /^\/api\/staff\/\d+$/, requirement: "staff.edit" },
  { method: "DELETE", pattern: /^\/api\/staff\/\d+$/, requirement: "staff.delete" },
  { method: "POST", pattern: /^\/api\/staff\/import$/, requirement: "staff.create" },
  { method: "POST", pattern: /^\/api\/staff\/\d+\/reset-mobile-id$/, requirement: "staff.edit" },
  { method: "PUT", pattern: /^\/api\/staff\/\d+\/subjects$/, requirement: "staff.edit" },
  { method: "PUT", pattern: /^\/api\/staff\/\d+\/classes$/, requirement: "staff.edit" },
  { method: "POST", pattern: /^\/api\/staff\/\d+\/user$/, requirement: "users.create" },
  { method: "PUT", pattern: /^\/api\/staff\/\d+\/user\/password$/, requirement: "users.manage_permissions" },
  { method: "PUT", pattern: /^\/api\/staff\/\d+\/user\/status$/, requirement: "users.manage_permissions" },
  { method: "POST", pattern: /^\/api\/staff\/\d+\/photo$/, requirement: "staff.edit" },

  { method: "POST", pattern: /^\/api\/streams$/, requirement: "classes.create" },
  { method: "POST", pattern: /^\/api\/classes$/, requirement: "classes.create" },
  { method: "PUT", pattern: /^\/api\/classes\/\d+$/, requirement: "classes.edit" },
  { method: "DELETE", pattern: /^\/api\/classes\/\d+$/, requirement: "classes.delete" },
  { method: "POST", pattern: /^\/api\/classes\/\d+\/subjects$/, requirement: "classes.edit" },
  { method: "DELETE", pattern: /^\/api\/classes\/\d+\/subjects\/\d+$/, requirement: "classes.edit" },
  { method: "PUT", pattern: /^\/api\/classes\/\d+\/subjects$/, requirement: "classes.edit" },
  { method: "POST", pattern: /^\/api\/classes\/\d+\/migrate$/, requirement: "classes.edit" },

  { method: "POST", pattern: /^\/api\/parents$/, requirement: "parents.create" },
  { method: "PUT", pattern: /^\/api\/parents\/\d+$/, requirement: "parents.edit" },
  { method: "DELETE", pattern: /^\/api\/parents\/\d+$/, requirement: "parents.delete" },
  { method: "POST", pattern: /^\/api\/parents\/import$/, requirement: "parents.create" },
  { method: "POST", pattern: /^\/api\/parents\/\d+\/user$/, requirement: "users.create" },
  { method: "PUT", pattern: /^\/api\/parents\/\d+\/user\/password$/, requirement: "users.manage_permissions" },
  { method: "PUT", pattern: /^\/api\/parents\/\d+\/user\/status$/, requirement: "users.manage_permissions" },

  { method: "POST", pattern: /^\/api\/students$/, requirement: "students.create" },
  { method: "PUT", pattern: /^\/api\/students\/\d+$/, requirement: "students.edit" },
  { method: "DELETE", pattern: /^\/api\/students\/\d+$/, requirement: "students.delete" },
  { method: "POST", pattern: /^\/api\/students\/\d+\/transfer$/, requirement: "students.edit" },
  { method: "POST", pattern: /^\/api\/students\/\d+\/photo$/, requirement: "students.edit" },
  { method: "PUT", pattern: /^\/api\/students\/\d+\/subjects$/, requirement: "students.edit" },
  { method: "POST", pattern: /^\/api\/students\/import$/, requirement: "students.create" },
  { method: "POST", pattern: /^\/api\/students\/\d+\/user$/, requirement: "users.create" },
  { method: "PUT", pattern: /^\/api\/students\/\d+\/user\/password$/, requirement: "users.manage_permissions" },
  { method: "PUT", pattern: /^\/api\/students\/\d+\/user\/status$/, requirement: "users.manage_permissions" },

  { method: "POST", pattern: /^\/api\/subjects$/, requirement: "subjects.create" },
  { method: "PUT", pattern: /^\/api\/subjects\/\d+$/, requirement: "subjects.edit" },
  { method: "DELETE", pattern: /^\/api\/subjects\/\d+$/, requirement: "subjects.delete" },

  { method: "POST", pattern: /^\/api\/grades$/, requirement: "grades.create" },
  { method: "PUT", pattern: /^\/api\/grades\/\d+$/, requirement: "grades.edit" },
  { method: "DELETE", pattern: /^\/api\/grades\/\d+$/, requirement: "grades.delete" },

  { method: "DELETE", pattern: /^\/api\/assessments\/\d+$/, requirement: "assessments.delete" },
  { method: "POST", pattern: /^\/api\/marks(\/bulk)?$/, requirement: "marks.create" },
  { method: "POST", pattern: /^\/api\/attendance(\/bulk)?$/, requirement: "attendance.create" },
  { method: "PUT", pattern: /^\/api\/attendance\/\d+$/, requirement: "attendance.edit" },
  { method: "POST", pattern: /^\/api\/discipline$/, requirement: "discipline.create" },
  { method: "POST", pattern: /^\/api\/clinic$/, requirement: "clinic.create" },
  { method: "PUT", pattern: /^\/api\/clinic\/\d+$/, requirement: "clinic.edit" },
  { method: "DELETE", pattern: /^\/api\/clinic\/\d+$/, requirement: "clinic.delete" },
  { method: "POST", pattern: /^\/api\/clinic\/import$/, requirement: "clinic.create" },

  { method: "POST", pattern: /^\/api\/fees$/, requirement: ["fees.create", "fees.manage_structure"] },
  { method: "POST", pattern: /^\/api\/fees\/import-csv$/, requirement: "fees.manage_structure" },
  { method: "POST", pattern: /^\/api\/fees\/notify$/, requirement: ["fees.view", "communication.send"] },

  { method: "GET", pattern: /^\/api\/organizations$/, requirement: "settings.view" },
  { method: "POST", pattern: /^\/api\/organizations$/, requirement: "settings.edit" },
  { method: "PUT", pattern: /^\/api\/organizations\/\d+$/, requirement: "settings.edit" },
  { method: "POST", pattern: /^\/api\/schools$/, requirement: "settings.edit" },
  { method: "PUT", pattern: /^\/api\/schools\/\d+$/, requirement: "settings.edit" },
  { method: "DELETE", pattern: /^\/api\/schools\/\d+$/, requirement: "settings.edit" },
  { method: "POST", pattern: /^\/api\/schools\/\d+\/(restore|unarchive)$/, requirement: "settings.edit" },
  { method: "GET", pattern: /^\/api\/archived-schools$/, requirement: "settings.view" },

  { method: "GET", pattern: /^\/api\/activity-logs(\/export)?$/, requirement: "activity_logs.view" },
  { method: "POST", pattern: /^\/api\/library\/resources$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/resources\/\d+$/, requirement: "library.upload" },
  { method: "DELETE", pattern: /^\/api\/library\/resources\/\d+$/, requirement: "library.delete" },
  { method: "POST", pattern: /^\/api\/library\/categories$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/categories\/\d+$/, requirement: "library.upload" },
  { method: "DELETE", pattern: /^\/api\/library\/categories\/\d+$/, requirement: "library.delete" },
  { method: "POST", pattern: /^\/api\/library\/books$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/books\/\d+$/, requirement: "library.upload" },
  { method: "DELETE", pattern: /^\/api\/library\/books\/\d+$/, requirement: "library.delete" },
  { method: "POST", pattern: /^\/api\/library\/books\/\d+\/copies$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/copies\/\d+$/, requirement: "library.upload" },
  { method: "DELETE", pattern: /^\/api\/library\/copies\/\d+$/, requirement: "library.delete" },
  { method: "POST", pattern: /^\/api\/library\/loans$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/loans\/\d+\/(return|lost)$/, requirement: "library.upload" },
  { method: "POST", pattern: /^\/api\/library\/fines$/, requirement: "library.upload" },
  { method: "PUT", pattern: /^\/api\/library\/fines\/\d+$/, requirement: "library.delete" },
  { method: "POST", pattern: /^\/api\/library\/books\/\d+\/cover$/, requirement: "library.upload" },
  { method: "POST", pattern: /^\/api\/library\/policy$/, requirement: "settings.edit" },
  { method: "POST", pattern: /^\/api\/library\/books\/import$/, requirement: "library.upload" },

  { method: "POST", pattern: /^\/api\/timetable$/, requirement: "timetable.create" },
  { method: "PUT", pattern: /^\/api\/timetable\/\d+$/, requirement: "timetable.edit" },
  { method: "DELETE", pattern: /^\/api\/timetable\/\d+$/, requirement: "timetable.delete" },

  { method: "POST", pattern: /^\/api\/logbook$/, requirement: "logbook.create" },
  { method: "PUT", pattern: /^\/api\/logbook\/\d+$/, requirement: "logbook.edit" },
  { method: "DELETE", pattern: /^\/api\/logbook\/\d+$/, requirement: "logbook.delete" },

  { method: "POST", pattern: /^\/api\/pos\/items$/, requirement: "pos.manage_items" },
  { method: "PUT", pattern: /^\/api\/pos\/items\/\d+$/, requirement: "pos.manage_items" },
  { method: "DELETE", pattern: /^\/api\/pos\/items\/\d+$/, requirement: "pos.manage_items" },
  { method: "POST", pattern: /^\/api\/pos\/sales$/, requirement: "pos.create_sale" },

  { method: "POST", pattern: /^\/api\/newsletters$/, requirement: "newsletters.create" },
  { method: "PUT", pattern: /^\/api\/newsletters\/\d+$/, requirement: "newsletters.edit" },
  { method: "DELETE", pattern: /^\/api\/newsletters\/\d+$/, requirement: "newsletters.delete" },

  { method: "POST", pattern: /^\/api\/schemes$/, requirement: "schemes.create" },
  { method: "PUT", pattern: /^\/api\/schemes\/\d+$/, requirement: "schemes.edit" },
  { method: "DELETE", pattern: /^\/api\/schemes\/\d+$/, requirement: "schemes.delete" },

  { method: "POST", pattern: /^\/api\/hostels$/, requirement: "hostels.create" },
  { method: "PUT", pattern: /^\/api\/hostels\/\d+$/, requirement: "hostels.edit" },
  { method: "DELETE", pattern: /^\/api\/hostels\/\d+$/, requirement: "hostels.delete" },
  { method: "POST", pattern: /^\/api\/hostel\/rollcall(\/bulk)?$/, requirement: "hostel.create" },

  { method: "GET", pattern: /^\/api\/applications$/, requirement: "applications.view" },
  { method: "PUT", pattern: /^\/api\/applications\/\d+$/, requirement: "applications.process" },

  { method: "GET", pattern: /^\/api\/permissions$/, requirement: "access_groups.view" },
  { method: "POST", pattern: /^\/api\/permissions$/, requirement: "access_groups.manage" },
  { method: "PUT", pattern: /^\/api\/permissions\/\d+$/, requirement: "access_groups.manage" },
  { method: "DELETE", pattern: /^\/api\/permissions\/\d+$/, requirement: "access_groups.manage" },
  { method: "GET", pattern: /^\/api\/access-groups(\/\d+)?(\/permissions)?$/, requirement: "access_groups.view" },
  { method: "POST", pattern: /^\/api\/access-groups$/, requirement: "access_groups.manage" },
  { method: "PUT", pattern: /^\/api\/access-groups\/\d+(\/permissions)?$/, requirement: "access_groups.manage" },
  { method: "DELETE", pattern: /^\/api\/access-groups\/\d+$/, requirement: "access_groups.manage" },
  { method: "POST", pattern: /^\/api\/staff-roles$/, requirement: "settings.edit" },
  { method: "PUT", pattern: /^\/api\/staff-roles\/\d+$/, requirement: "settings.edit" },
  { method: "DELETE", pattern: /^\/api\/staff-roles\/\d+$/, requirement: "settings.edit" },
  { method: "GET", pattern: /^\/api\/users\/\d+\/(access-groups|permissions|permission-overrides)$/, requirement: ["users.view", "users.manage_permissions"] },
  { method: "POST", pattern: /^\/api\/users\/\d+\/(access-groups|permission-overrides)$/, requirement: "users.manage_permissions" },
  { method: "DELETE", pattern: /^\/api\/users\/\d+\/access-groups\/\d+$/, requirement: "users.manage_permissions" },
  { method: "DELETE", pattern: /^\/api\/users\/\d+\/permission-overrides(\/\d+)?$/, requirement: "users.manage_permissions" },

  { method: "GET", pattern: /^\/api\/record-of-marks$/, requirement: "record_of_marks.view" },
  { method: "POST", pattern: /^\/api\/report-comments$/, requirement: "reports.generate" },
  { method: "DELETE", pattern: /^\/api\/report-comments\/\d+$/, requirement: "reports.generate" },
];

async function getUserPermissionCodes(userId: number): Promise<string[]> {
  const effectivePermissions = await storage.getUserEffectivePermissions(userId);
  return effectivePermissions
    .filter(({ granted }) => granted)
    .map(({ permission }) => permission.code);
}

async function userMatchesLoginRole(user: User, loginRole: string): Promise<boolean> {
  if (loginRole === "student") return user.role === "student";
  if (loginRole === "parent") return user.role === "parent";
  if (loginRole === "org_member") return user.role === "org_admin";
  if (loginRole !== "staff") return true;
  return STAFF_LOGIN_ROLES.has(user.role);
}

function getLegacyRequirementForRequest(req: Request): PermissionRequirement | null {
  const path = req.path || req.originalUrl || "";
  const method = req.method.toUpperCase();
  for (const rule of LEGACY_ROUTE_PERMISSION_RULES) {
    if (rule.method && rule.method !== method) continue;
    if (rule.pattern.test(path)) return rule.requirement;
  }
  return null;
}

async function hasRequiredPermissions(userId: number, requirement: PermissionRequirement): Promise<boolean> {
  const requirements = Array.isArray(requirement) ? requirement : [requirement];
  for (const permissionCode of requirements) {
    if (await storage.userHasPermission(userId, permissionCode)) {
      return true;
    }
  }
  return false;
}

async function buildAuthenticatedUserResponse(user: User, schoolHeader?: string | string[] | undefined) {
  const { password: _, ...userWithoutPassword } = user;

  let schoolTermination: { terminationAt: string; terminationStatus: string } | null = null;
  const schoolId = user.role === "org_admin"
    ? (typeof schoolHeader === "string" ? parseInt(schoolHeader, 10) : null)
    : user.schoolId;

  if (schoolId) {
    try {
      const school = await storage.getSchool(schoolId);
      if (school && (school.terminationStatus === "pending" || school.terminationStatus === "archived")) {
        schoolTermination = {
          terminationAt: (school.terminationAt || school.archivedAt || new Date()).toISOString(),
          terminationStatus: school.terminationStatus,
        };
      }
    } catch (e) {}
  }

  const effectivePermissions = await getUserPermissionCodes(user.id);

  return {
    ...userWithoutPassword,
    effectivePermissions,
    schoolTermination,
  };
}

export function setupAuth(app: Express): void {
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }
  
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "fcgs-school-dev-secret-2026",
    resave: true,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
    },
    store: new MemoryStore({
      checkPeriod: 3600000,
    }),
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        let user = await storage.getUserByUsername(username);
        if (!user && username.includes("@")) {
          user = await storage.getUserByEmail(username);
        }
        if (!user) {
          user = await storage.getUserByPhone(username);
        }
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        const isValid = await comparePasswords(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
        if (user.isActive === false) {
          return done(null, false, { message: "Your account has been deactivated. Please contact an administrator." });
        }
        if (user.schoolId && user.role !== "org_admin") {
          const school = await storage.getSchool(user.schoolId);
          if (school) {
            if (school.terminationStatus === "archived") {
              return done(null, false, { message: `${school.name} has been archived. Contact your organization HQ for assistance.` });
            }
            if (school.terminationStatus === "pending" && school.terminationAt) {
              const hoursLeft = (new Date(school.terminationAt).getTime() - Date.now()) / (1000 * 60 * 60);
              if (hoursLeft <= 1) {
                return done(null, false, { message: `${school.name} is locked out pending archival. Contact your organization HQ for assistance.` });
              }
            }
          }
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { username, password, email, role, firstName, lastName, phone } = req.body;

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        email,
        role: role || "student",
        firstName,
        lastName,
        phone,
      });

      if (role === "org_admin") {
        try {
          const accessGroups = await storage.getAllAccessGroups();
          const orgHqGroup = accessGroups.find(g => g.name === "Org HQ");
          if (orgHqGroup) {
            await storage.addUserToAccessGroup({ userId: user.id, accessGroupId: orgHqGroup.id });
          }
        } catch (e) {
          console.error("Error assigning Org HQ access group to new org_admin:", e);
        }
      }

      req.login(user, (err) => {
        if (err) return next(err);
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    const { loginRole } = req.body;
    
    passport.authenticate("local", async (err: any, user: User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Login failed" });
      }
      
      if (loginRole) {
        const loginRoleMatches = await userMatchesLoginRole(user, loginRole);
        if (!loginRoleMatches) {
          return res.status(401).json({ 
            message: `Invalid login. Your account is not registered as ${loginRole === "org_member" ? "an Org HQ member" : `a ${loginRole}`}.`
          });
        }
      }
      
      if (user.schoolId && user.role !== "org_admin") {
        try {
          const school = await storage.getSchool(user.schoolId);
          if (school) {
            if (school.terminationStatus === "archived") {
              return res.status(403).json({ message: "This school has been archived and is no longer accessible." });
            }
            if (school.terminationStatus === "pending" && school.terminationAt) {
              const hoursLeft = (new Date(school.terminationAt).getTime() - Date.now()) / (1000 * 60 * 60);
              if (hoursLeft <= 1) {
                return res.status(403).json({ message: "This school is in lockout mode and no longer accepting logins. The school will be archived shortly." });
              }
            }
          }
        } catch (e) {}
      }

      req.login(user, async (err) => {
        if (err) return next(err);
        
        if (user.tempPasswordLoginsRemaining !== null && user.tempPasswordLoginsRemaining > 0) {
          const remaining = user.tempPasswordLoginsRemaining - 1;
          const updates: any = { tempPasswordLoginsRemaining: remaining };
          if (remaining <= 0) {
            updates.mustResetPassword = true;
          }
          await storage.updateUser(user.id, updates);
        }
        
        try {
          await storage.createActivityLog({
            schoolId: user.schoolId,
            organizationId: user.organizationId,
            userId: user.id,
            userName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username,
            userRole: user.role,
            action: "login",
            category: "authentication",
            description: `${user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username} logged in`,
            ipAddress: req.ip || req.socket.remoteAddress || null,
          });
        } catch (e) {}
        
        const responseUser = await buildAuthenticatedUserResponse(user);
        res.json({
          ...responseUser,
          mustResetPassword: user.mustResetPassword || (user.tempPasswordLoginsRemaining !== null && user.tempPasswordLoginsRemaining <= 1),
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/reset-password-with-token", async (req, res, next) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      if (newPassword.length < 8 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
        return res.status(400).json({ message: "Password must be at least 8 characters with uppercase, lowercase, and special character" });
      }
      const allUsers = await storage.getAllUsers();
      const user = allUsers.find(u => u.passwordResetToken === token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      if (user.passwordResetTokenExpiry && new Date() > new Date(user.passwordResetTokenExpiry)) {
        return res.status(400).json({ message: "Reset token has expired. Please request a new one." });
      }
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
        mustResetPassword: false,
        tempPasswordLoginsRemaining: null,
      });
      res.json({ message: "Password has been reset successfully. You can now log in with your new password." });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/force-reset-password", async (req, res, next) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const { newPassword } = req.body;
      if (!newPassword) {
        return res.status(400).json({ message: "New password is required" });
      }
      if (newPassword.length < 8 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
        return res.status(400).json({ message: "Password must be at least 8 characters with uppercase, lowercase, and special character" });
      }
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(req.user.id, {
        password: hashedPassword,
        mustResetPassword: false,
        tempPasswordLoginsRemaining: null,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      });
      const updatedUser = await storage.getUser(req.user.id);
      if (updatedUser) {
        const { password: _, ...userWithoutPassword } = updatedUser;
        return res.json({ message: "Password reset successfully", user: userWithoutPassword });
      }
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const user = req.user as User | undefined;
    if (user) {
      try {
        await storage.createActivityLog({
          schoolId: user.schoolId,
          organizationId: user.organizationId,
          userId: user.id,
          userName: user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username,
          userRole: user.role,
          action: "logout",
          category: "authentication",
          description: `${user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user.username} logged out`,
          ipAddress: req.ip || req.socket.remoteAddress || null,
        });
      } catch (e) {}
    }
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/user", async (req, res) => {
    if (req.isAuthenticated() && req.user) {
      const userResponse = await buildAuthenticatedUserResponse(req.user, req.headers["x-school-id"]);
      res.json(userResponse);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
}

export function requirePermission(permission: string) {
  return requireAnyPermission(permission);
}

export function requireAnyPermission(...permissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const hasPermission = await hasRequiredPermissions(req.user.id, permissions);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
}

export function requireRole(..._roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const inferredRequirement = getLegacyRequirementForRequest(req);
    if (!inferredRequirement) {
      return res.status(403).json({ message: "Access denied" });
    }

    const hasPermission = await hasRequiredPermissions(req.user.id, inferredRequirement);
    if (!hasPermission) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
}

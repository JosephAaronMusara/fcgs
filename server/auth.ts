import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { User } from "@shared/schema";

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
          const allPermissions = await storage.getAllPermissions();
          const allSchools = await storage.getAllSchools();
          const allPermIds = allPermissions.map(p => p.id);
          const allSchoolIds = allSchools.map(s => s.id);
          await storage.updateUserPermissions(user.id, allSchoolIds, allPermIds);
          const accessGroups = await storage.getAllAccessGroups();
          const orgHqGroup = accessGroups.find(g => g.name === "Org HQ");
          if (orgHqGroup) {
            await storage.addUserToAccessGroup({ userId: user.id, accessGroupId: orgHqGroup.id });
          }
        } catch (e) {
          console.error("Error auto-granting permissions for new org_admin:", e);
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
      
      // Validate loginRole matches user's actual role
      if (loginRole) {
        const roleMap: Record<string, string[]> = {
          "staff": ["school_admin", "teacher", "librarian"],
          "student": ["student"],
          "parent": ["parent"],
          "org_member": ["org_admin"],
        };
        
        const allowedRoles = roleMap[loginRole] || [];
        if (!allowedRoles.includes(user.role)) {
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
        
        const { password: _, ...userWithoutPassword } = user;

        let schoolTermination: { terminationAt: string; terminationStatus: string } | null = null;
        if (user.schoolId) {
          try {
            const school = await storage.getSchool(user.schoolId);
            if (school && (school.terminationStatus === "pending" || school.terminationStatus === "archived")) {
              schoolTermination = {
                terminationAt: (school.terminationAt || school.archivedAt || new Date()).toISOString(),
                terminationStatus: school.terminationStatus,
              };
            }
          } catch (e) {}
        }

        res.json({
          ...userWithoutPassword,
          mustResetPassword: user.mustResetPassword || (user.tempPasswordLoginsRemaining !== null && user.tempPasswordLoginsRemaining <= 1),
          schoolTermination,
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
      const { password: _, ...userWithoutPassword } = req.user;

      let schoolTermination: { terminationAt: string; terminationStatus: string } | null = null;
      const schoolId = req.user.role === "org_admin"
        ? (req.headers["x-school-id"] ? parseInt(req.headers["x-school-id"] as string, 10) : null)
        : req.user.schoolId;

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

      res.json({ ...userWithoutPassword, schoolTermination });
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

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient, User } from '@supabase/supabase-js';

// Load environment variables from .env
dotenv.config();

// Ensure HMR is disabled in AI Studio environment to prevent WebSocket closed errors
if (process.env.DISABLE_HMR === undefined) {
  process.env.DISABLE_HMR = 'true';
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));


const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

// Server-side only service-role key
function getServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function getAdminClient() {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey || !supabaseUrl) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAnonClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Role verification helper
function isUserAdmin(user: User): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as Record<string, unknown>)?.role;
  const userRole = (user.user_metadata as Record<string, unknown>)?.role;

  if (appRole === 'admin' || appRole === 'tech-admin') return true;
  if (userRole === 'admin' || userRole === 'tech-admin') return true;

  // Primary administrator email for this deployment
  if (user.email && user.email.toLowerCase() === 'elmubaraq69@gmail.com') return true;

  // Any admin@ account
  if (user.email && user.email.toLowerCase().startsWith('admin@')) return true;

  // Optional custom ADMIN_EMAILS from environment
  const envAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && envAdmins.includes(user.email.toLowerCase())) return true;

  return false;
}

// Middleware: Authenticate user using Supabase Bearer token
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.substring(7).trim();
  const anonClient = getAnonClient();
  if (!anonClient) {
    return res.status(500).json({ error: 'Supabase configuration is missing on server.' });
  }

  try {
    const { data: { user }, error } = await anonClient.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired authentication session.' });
    }

    (req as any).user = user;
    next();
  } catch (err: any) {
    console.error('requireAuth error:', err);
    return res.status(401).json({ error: 'Failed to verify authentication token.' });
  }
}

// Middleware: Require administrative privilege
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as User;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (!isUserAdmin(user)) {
    return res.status(403).json({
      error: 'Insufficient administrative privileges. Only authorized administrators can perform this action.',
    });
  }

  next();
}

// ============================================================================
// API ROUTES (/api/*)
// ============================================================================

// 1. Check Admin status and service key readiness
app.get('/api/admin/status', requireAuth, requireAdmin, (req: Request, res: Response) => {
  res.json({
    isAdmin: true,
    serviceKeyConfigured: Boolean(getServiceRoleKey()),
  });
});

// 2. Set/Update Service Role Key (Admin only, saved securely on server)
app.post('/api/admin/set-service-key', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { serviceRoleKey } = req.body;
  if (!serviceRoleKey || typeof serviceRoleKey !== 'string') {
    return res.status(400).json({ error: 'serviceRoleKey string is required.' });
  }

  const cleanKey = serviceRoleKey.trim();

  // Test key against Supabase Auth Admin API
  try {
    const testAdmin = createClient(supabaseUrl, cleanKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await testAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      return res.status(400).json({
        error: `Supabase rejected service-role key: ${error.message}`,
      });
    }

    // Set in process.env
    process.env.SUPABASE_SERVICE_ROLE_KEY = cleanKey;

    // Append / update in .env file
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('SUPABASE_SERVICE_ROLE_KEY=')) {
        envContent = envContent.replace(
          /SUPABASE_SERVICE_ROLE_KEY=.*/g,
          `SUPABASE_SERVICE_ROLE_KEY="${cleanKey}"`
        );
      } else {
        envContent += `\nSUPABASE_SERVICE_ROLE_KEY="${cleanKey}"\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch (writeErr) {
      console.warn('Could not write to .env, kept in server memory:', writeErr);
    }

    return res.json({
      success: true,
      message: 'Supabase Service Role Key verified and configured securely on server.',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: `Failed to verify service-role key: ${err?.message || err}`,
    });
  }
});

// 3. List Users for Admin User Management Area
app.get('/api/admin/users', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.json({
      users: [],
      serviceKeyConfigured: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
    });
  }

  try {
    const { data, error } = await adminClient.auth.admin.listUsers();
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Sanitize user list (do not expose internal password hashes)
    const sanitized = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      user_metadata: u.user_metadata || {},
      app_metadata: u.app_metadata || {},
    }));

    return res.json({
      users: sanitized,
      serviceKeyConfigured: true,
    });
  } catch (err: any) {
    console.error('listUsers error:', err);
    return res.status(500).json({ error: err.message || 'Failed to list users.' });
  }
});

// 4. Secure Manual Admin Password Reset
app.post('/api/admin/reset-password', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const { targetUserId, targetEmail, newPassword } = req.body;
  const adminUser = (req as any).user as User;

  const targetIdentifier = (targetUserId || targetEmail || '').trim();
  if (!targetIdentifier) {
    return res.status(400).json({ error: 'targetUserId or targetEmail is required.' });
  }

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'newPassword is required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Temporary password must be at least 6 characters long.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(500).json({
      error: 'Supabase service-role key is not configured on the server. Please configure SUPABASE_SERVICE_ROLE_KEY to enable admin password resets.',
    });
  }

  try {
    let resolvedUserId = '';
    let targetUserEmail = '';

    // If identifier contains @, resolve via listUsers email match
    if (targetIdentifier.includes('@')) {
      const searchEmail = targetIdentifier.toLowerCase();
      const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) {
        return res.status(400).json({ error: listErr.message });
      }
      const match = (listData.users || []).find((u) => u.email?.toLowerCase() === searchEmail);
      if (!match) {
        return res.status(404).json({ error: `User with email "${searchEmail}" not found in Supabase Auth.` });
      }
      resolvedUserId = match.id;
      targetUserEmail = match.email || searchEmail;
    } else {
      // Look up by UUID
      resolvedUserId = targetIdentifier;
      const { data: targetUserObj, error: getErr } = await adminClient.auth.admin.getUserById(resolvedUserId);
      if (getErr || !targetUserObj?.user) {
        return res.status(404).json({ error: `User with ID "${resolvedUserId}" not found in Supabase Auth.` });
      }
      targetUserEmail = targetUserObj.user.email || '';
    }

    // Call Supabase Admin Auth API to update the user password
    const { data: updatedUser, error: updateErr } = await adminClient.auth.admin.updateUserById(resolvedUserId, {
      password: newPassword,
    });

    if (updateErr) {
      console.error('updateUserById error:', updateErr);
      return res.status(400).json({ error: updateErr.message });
    }

    console.log(
      `[AUDIT LOG] Administrator (${adminUser.email}) manually reset password for user ${targetUserEmail} (${resolvedUserId})`
    );

    return res.json({
      success: true,
      message: 'Password reset successfully. Give the temporary password to the user through a secure channel.',
      targetUser: {
        id: resolvedUserId,
        email: targetUserEmail,
      },
    });
  } catch (err: any) {
    console.error('Password reset endpoint error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to execute password reset on server.' });
  }
});

// ============================================================================
// VITE SPA INTEGRATION (Express + Vite Middleware)
// ============================================================================
async function startServer() {
  const httpServer = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve built dist files
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`myRet Full-Stack Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

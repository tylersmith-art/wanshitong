import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  users,
  organizations,
  orgMembers,
  projects,
  architectureSpecs,
  projectSpecs,
  apiKeys,
} from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

const seedUsers = [
  { name: "Admin User", email: "admin@example.com", role: "admin" as const },
  { name: "Alice", email: "alice@example.com", role: "user" as const },
  { name: "Bob", email: "bob@example.com", role: "user" as const },
];

async function main() {
  console.log("Seeding database...");

  // ── Users ─────────────────────────────────────────────────────────────
  const userMap: Record<string, string> = {};

  for (const user of seedUsers) {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, user.email))
      .limit(1);

    if (existing.length === 0) {
      const [created] = await db.insert(users).values(user).returning();
      userMap[user.email] = created.id;
      console.log(`  Created user: ${user.email} (${user.role})`);
    } else {
      userMap[user.email] = existing[0].id;
      console.log(`  Skipped user: ${user.email} (already exists)`);
    }
  }

  // ── Organization ──────────────────────────────────────────────────────
  const orgSlug = "architecture-guild";
  let orgId: string;

  const existingOrg = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);

  if (existingOrg.length === 0) {
    const [created] = await db
      .insert(organizations)
      .values({ name: "Architecture Guild", slug: orgSlug })
      .returning();
    orgId = created.id;
    console.log(`  Created org: ${created.name}`);
  } else {
    orgId = existingOrg[0].id;
    console.log(`  Skipped org: ${existingOrg[0].name} (already exists)`);
  }

  // ── Org Members ───────────────────────────────────────────────────────
  const memberSeeds = [
    { userId: userMap["admin@example.com"], role: "owner" as const },
    { userId: userMap["alice@example.com"], role: "member" as const },
  ];

  for (const member of memberSeeds) {
    const existing = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, member.userId))
      .limit(1);

    if (existing.length === 0) {
      await db
        .insert(orgMembers)
        .values({ orgId, userId: member.userId, role: member.role });
      console.log(`  Created org member: ${member.role}`);
    } else {
      console.log(`  Skipped org member: ${member.role} (already exists)`);
    }
  }

  // ── Project ───────────────────────────────────────────────────────────
  const projectName = "Wan Shi Tong Demo";
  let projectId: string;

  const existingProject = await db
    .select()
    .from(projects)
    .where(eq(projects.name, projectName))
    .limit(1);

  if (existingProject.length === 0) {
    const [created] = await db
      .insert(projects)
      .values({
        orgId,
        name: projectName,
        description: "Demo project for the Wan Shi Tong architecture knowledge base",
      })
      .returning();
    projectId = created.id;
    console.log(`  Created project: ${created.name}`);
  } else {
    projectId = existingProject[0].id;
    console.log(`  Skipped project: ${existingProject[0].name} (already exists)`);
  }

  // ── Architecture Specs ────────────────────────────────────────────────
  const adminUserId = userMap["admin@example.com"];

  const specSeeds = [
    {
      name: "REST API Design Patterns",
      description: "Conventions and best practices for designing RESTful APIs",
      content: `Resource naming should follow a consistent, noun-based convention. Use plural nouns for collection endpoints (e.g., /users, /orders) and nest sub-resources to express relationships (e.g., /users/{id}/orders). Avoid verbs in URIs since the HTTP method already conveys the action. Use kebab-case for multi-word path segments and lowercase throughout.

HTTP methods must be used according to their defined semantics. GET retrieves a representation without side effects. POST creates a new resource within a collection. PUT replaces the entire resource at the given URI, while PATCH applies a partial update. DELETE removes the resource. Idempotency guarantees for PUT and DELETE simplify retry logic in distributed systems.

Status codes communicate the outcome of each request. Use 200 for successful reads, 201 for resource creation with a Location header, 204 for successful deletes with no body. Client errors use the 4xx range: 400 for malformed input, 401 for missing credentials, 403 for insufficient permissions, 404 for unknown resources, and 409 for conflicts. Server errors use 5xx and should include a correlation ID for tracing.

Pagination should use cursor-based navigation for large or frequently changing datasets. Return a response envelope with a "data" array, a "nextCursor" field, and a "hasMore" boolean. Accept "limit" and "cursor" query parameters. For simpler use cases, offset-based pagination with "page" and "pageSize" is acceptable but degrades on large tables. Versioning is best handled through URI path prefixes (e.g., /v1/users) to keep routing explicit and CDN-friendly.`,
      visibility: "global" as const,
    },
    {
      name: "Authentication & Authorization Patterns",
      description: "Patterns for securing APIs with JWT, OAuth2, RBAC, and API keys",
      content: `JSON Web Tokens (JWT) provide a stateless authentication mechanism well-suited for microservices. Access tokens should be short-lived (5-15 minutes) and carry only the claims needed for authorization decisions: subject, roles, and token expiry. Refresh tokens should be opaque, stored server-side with rotation on each use, and bound to the device or session that created them. Always validate the signature, issuer, audience, and expiry on every request.

OAuth 2.0 should be used for delegated access scenarios. The Authorization Code flow with PKCE is the recommended grant type for both server-side and single-page applications. Client Credentials flow is appropriate for service-to-service communication where no user context is needed. Avoid the Implicit flow as it exposes tokens in the URL fragment. Store client secrets securely and rotate them on a regular schedule.

Role-Based Access Control (RBAC) maps users to roles and roles to permissions. Define roles at the organization level (owner, admin, member, viewer) and enforce them at the API layer before executing business logic. For finer-grained control, combine RBAC with attribute-based policies that consider resource ownership, organization membership, and contextual factors such as IP range or time of day.

API key authentication is suitable for server-to-server integrations and metered access. Keys should be hashed with a strong algorithm (SHA-256 or bcrypt) before storage. Expose only a short prefix (e.g., "wst_abc") so users can identify keys without revealing the secret. Implement per-key rate limits, log every request against the key for auditing, and support immediate revocation. Session management for browser-based clients should use secure, HttpOnly, SameSite cookies backed by a server-side session store with configurable TTL.`,
      visibility: "global" as const,
    },
    {
      name: "Database Schema Design",
      description: "Patterns for normalization, indexing, migrations, and connection pooling",
      content: `Normalization to third normal form (3NF) eliminates redundancy and prevents update anomalies. Every non-key column should depend on the primary key, the whole key, and nothing but the key. Selectively denormalize only when read performance demands it and the denormalized data has a clear cache-invalidation strategy. Use materialized views or dedicated read models rather than embedding computed values directly in transactional tables.

Indexing strategy should be driven by query patterns. Create indexes on columns used in WHERE, JOIN, and ORDER BY clauses. Composite indexes must order columns from most selective to least selective and should cover the query when possible to avoid heap lookups. Use partial indexes to reduce index size when queries consistently filter on a fixed condition (e.g., WHERE deleted_at IS NULL). Monitor index usage and remove unused indexes to lower write amplification.

Migration patterns should guarantee zero-downtime deployments. Adopt an expand-contract approach: first add the new column or table without removing the old one, then backfill and dual-write, and finally drop the legacy structure. Every migration must be reversible. Run migrations in a transaction where the database supports transactional DDL. Version migration files sequentially and store them in source control alongside the application code.

Connection pooling prevents database connection exhaustion under load. Use a pool size of roughly 2-3 times the number of CPU cores available to the database server. Configure idle timeout to reclaim unused connections and set a maximum lifetime to prevent issues with stale connections behind load balancers. Application-level poolers like PgBouncer in transaction mode offer additional control and allow a larger number of application instances to share a fixed pool of database connections.`,
      visibility: "global" as const,
    },
  ];

  const specIds: string[] = [];

  for (const spec of specSeeds) {
    const existing = await db
      .select()
      .from(architectureSpecs)
      .where(eq(architectureSpecs.name, spec.name))
      .limit(1);

    if (existing.length === 0) {
      const [created] = await db
        .insert(architectureSpecs)
        .values({ ...spec, userId: adminUserId })
        .returning();
      specIds.push(created.id);
      console.log(`  Created spec: ${created.name}`);
    } else {
      specIds.push(existing[0].id);
      console.log(`  Skipped spec: ${existing[0].name} (already exists)`);
    }
  }

  // ── Project-Spec Attachments ──────────────────────────────────────────
  for (const specId of specIds) {
    const existing = await db
      .select()
      .from(projectSpecs)
      .where(eq(projectSpecs.specId, specId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(projectSpecs).values({ projectId, specId });
      console.log(`  Attached spec ${specId} to project`);
    } else {
      console.log(`  Skipped attachment for spec ${specId} (already exists)`);
    }
  }

  // ── API Key ───────────────────────────────────────────────────────────
  const apiKeyPrefix = "wst_demo_";

  const existingKey = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, apiKeyPrefix))
    .limit(1);

  if (existingKey.length === 0) {
    await db.insert(apiKeys).values({
      userId: adminUserId,
      name: "Demo Key",
      keyHash: "demo-hash-placeholder",
      keyPrefix: apiKeyPrefix,
    });
    console.log("  Created API key: Demo Key");
  } else {
    console.log("  Skipped API key: Demo Key (already exists)");
  }

  console.log("Seeding complete.");
  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

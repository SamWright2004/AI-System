import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PersonalisationStore } from "../../core/settings/types.js";

const shortText = z.string().trim().max(120);

const personalisationSchema = z
  .object({
    version: z.literal(1),
    owner: z
      .object({
        displayName: shortText,
        locale: shortText,
        timezone: shortText,
      })
      .strict(),
    assistant: z
      .object({
        displayName: shortText,
        tone: z.array(z.string().trim().min(1).max(80)).max(12),
        responseDetail: z.enum(["concise", "adaptive", "detailed"]),
      })
      .strict(),
    workingStyle: z
      .object({
        initiative: z.enum(["low", "balanced", "high"]),
        challengeAssumptions: z.boolean(),
        surfaceUncertainty: z.boolean(),
      })
      .strict(),
    pinnedInstructions: z.array(z.string().trim().min(1).max(1_000)).max(30),
  })
  .strict();

export function registerSettingsRoutes(
  app: FastifyInstance,
  dependencies: { personalisation: PersonalisationStore },
) {
  app.get("/api/v1/settings/personalisation", async () =>
    dependencies.personalisation.getProfile(),
  );

  app.put("/api/v1/settings/personalisation", async (request, reply) => {
    const parsed = personalisationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_PERSONALISATION",
        message: parsed.error.issues[0]?.message ?? "Invalid personalisation settings.",
      });
    }
    return dependencies.personalisation.updateProfile(parsed.data);
  });
}

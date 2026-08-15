import { readFile } from "node:fs/promises";
import { z } from "zod";
import type {
  ContextCandidate,
  ContextSource,
  ContextSourceInput,
  PersonalisationReader,
  PersonalisationSummary,
} from "../../core/context/types.js";

const shortText = z.string().trim().max(120);

const personalisationProfileSchema = z
  .object({
    version: z.literal(1),
    owner: z
      .object({
        displayName: shortText.default(""),
        locale: shortText.default(""),
        timezone: shortText.default(""),
      })
      .strict()
      .default({ displayName: "", locale: "", timezone: "" }),
    assistant: z
      .object({
        displayName: shortText.default(""),
        tone: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
        responseDetail: z.enum(["concise", "adaptive", "detailed"]).default("adaptive"),
      })
      .strict()
      .default({ displayName: "", tone: [], responseDetail: "adaptive" }),
    workingStyle: z
      .object({
        initiative: z.enum(["low", "balanced", "high"]).default("balanced"),
        challengeAssumptions: z.boolean().default(true),
        surfaceUncertainty: z.boolean().default(true),
      })
      .strict()
      .default({
        initiative: "balanced",
        challengeAssumptions: true,
        surfaceUncertainty: true,
      }),
    pinnedInstructions: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  })
  .strict();

type PersonalisationProfile = z.infer<typeof personalisationProfileSchema>;

function renderProfile(profile: PersonalisationProfile): string {
  const lines = [
    "These are explicit, owner-controlled settings. Apply them when relevant without repeatedly announcing them.",
  ];

  if (profile.owner.displayName) {
    lines.push(`Owner display name: ${profile.owner.displayName}`);
  }
  if (profile.owner.locale) {
    lines.push(`Owner locale: ${profile.owner.locale}`);
  }
  if (profile.owner.timezone) {
    lines.push(`Owner timezone: ${profile.owner.timezone}`);
  }
  if (profile.assistant.displayName) {
    lines.push(`Assistant display name: ${profile.assistant.displayName}`);
  }
  if (profile.assistant.tone.length > 0) {
    lines.push(`Preferred conversational tone: ${profile.assistant.tone.join(", ")}`);
  }

  lines.push(`Preferred response detail: ${profile.assistant.responseDetail}`);
  lines.push(`Initiative level: ${profile.workingStyle.initiative}`);
  lines.push(
    `Challenge weak assumptions: ${profile.workingStyle.challengeAssumptions ? "yes" : "no"}`,
  );
  lines.push(
    `Surface meaningful uncertainty: ${profile.workingStyle.surfaceUncertainty ? "yes" : "no"}`,
  );

  if (profile.pinnedInstructions.length > 0) {
    lines.push("Pinned instructions:");
    for (const instruction of profile.pinnedInstructions) {
      lines.push(`- ${instruction}`);
    }
  }

  return lines.join("\n");
}

export class FilePersonalisationSource implements ContextSource, PersonalisationReader {
  public readonly id = "personalisation-file";

  public constructor(private readonly filePath: string) {}

  public async load(_input: ContextSourceInput): Promise<ReadonlyArray<ContextCandidate>> {
    const profile = await this.readProfile();
    if (!profile) return [];

    return [
      {
        id: "owner-profile-v1",
        source: this.id,
        title: "Owner profile and working style",
        trust: "owner",
        priority: 1_000,
        content: renderProfile(profile),
      },
    ];
  }

  public async getSummary(): Promise<PersonalisationSummary> {
    const profile = await this.readProfile();
    return {
      ownerDisplayName: profile?.owner.displayName || null,
      assistantDisplayName: profile?.assistant.displayName || null,
    };
  }

  private async readProfile(): Promise<PersonalisationProfile | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`Could not parse personalisation profile ${this.filePath}: ${detail}`, {
        cause: error,
      });
    }

    const parsed = personalisationProfileSchema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid personalisation profile ${this.filePath}: ${detail}`);
    }

    return parsed.data;
  }
}

export type ResponseDetail = "concise" | "adaptive" | "detailed";
export type InitiativeLevel = "low" | "balanced" | "high";

export interface PersonalisationProfile {
  version: 1;
  owner: {
    displayName: string;
    locale: string;
    timezone: string;
  };
  assistant: {
    displayName: string;
    tone: string[];
    responseDetail: ResponseDetail;
  };
  workingStyle: {
    initiative: InitiativeLevel;
    challengeAssumptions: boolean;
    surfaceUncertainty: boolean;
  };
  pinnedInstructions: string[];
}

export interface PersonalisationStore {
  getProfile(): Promise<PersonalisationProfile>;
  updateProfile(profile: PersonalisationProfile): Promise<PersonalisationProfile>;
}

export const defaultPersonalisationProfile: PersonalisationProfile = {
  version: 1,
  owner: {
    displayName: "",
    locale: "en-GB",
    timezone: "Europe/London",
  },
  assistant: {
    displayName: "",
    tone: ["natural", "direct", "thoughtful", "opinionated"],
    responseDetail: "adaptive",
  },
  workingStyle: {
    initiative: "high",
    challengeAssumptions: true,
    surfaceUncertainty: true,
  },
  pinnedInstructions: [],
};

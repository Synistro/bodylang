import type { OrganId } from "../model/ids";
import { ORGAN_NAME } from "../model/systems";

export const isOrganId = (id: string | null): id is OrganId => id !== null && Object.hasOwn(ORGAN_NAME, id);

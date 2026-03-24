const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicIdPattern = /^TSK[0-9A-Z]{3,}$/i;

export const isValidTaskReference = (value: string): boolean => {
  const normalized = value.trim();
  return uuidPattern.test(normalized) || publicIdPattern.test(normalized.toUpperCase());
};

export const containsLink = (text: string): boolean => {
  const linkRegex = /(https?:\/\/\S+)|(www\.\S+)|(t\.me\/\S+)|(wa\.me\/\d+)|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
  const domainRegex = /\b[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?/i;
  return linkRegex.test(text) || domainRegex.test(text);
};

export const truncateNoteText = (text: string, maxLength = 50): string => {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
};

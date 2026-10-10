// Normalize only the comparison text; display and save the user's original content.
export const searchText = (value: string) => value.normalize('NFKC').toLowerCase();

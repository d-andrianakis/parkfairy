/** An option's id in the address suggestions, shared by the field and its lazily loaded list. */
export const optionId = (listId: string, index: number) => `${listId}-${index}`;

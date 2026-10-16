export type DateFilterMode = 'ALL' | 'DATE' | 'MONTH' | 'YEAR';

export interface PageFilterState {
  search: string;
  dateMode: DateFilterMode;
  date: string;
  month: string;
  year: string;
}

export const EMPTY_PAGE_FILTERS: PageFilterState = {
  search: '',
  dateMode: 'ALL',
  date: '',
  month: '',
  year: '',
};

export const normalizeSearchText = (value: unknown): string => {
  return String(value ?? '').toLowerCase().trim();
};

export const matchesSearch = (query: string, values: unknown[]): boolean => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return values.some(value => normalizeSearchText(value).includes(normalizedQuery));
};

const toDateParts = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toISOString().slice(0, 10),
    month: date.toISOString().slice(0, 7),
    year: String(date.getFullYear()),
  };
};

export const matchesDateFilter = (filters: PageFilterState, values: (string | null | undefined)[]): boolean => {
  if (filters.dateMode === 'ALL') return true;
  const parts = values.map(toDateParts).filter(Boolean) as NonNullable<ReturnType<typeof toDateParts>>[];
  if (filters.dateMode === 'DATE') return !filters.date || parts.some(part => part.date === filters.date);
  if (filters.dateMode === 'MONTH') return !filters.month || parts.some(part => part.month === filters.month);
  if (filters.dateMode === 'YEAR') return !filters.year || parts.some(part => part.year === filters.year);
  return true;
};

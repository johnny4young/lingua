import { EmptyState } from 'lingua';

const FileText = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></svg>
);
const Search = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);

export const NoResults = () => (
  <EmptyState
    icon={<FileText />}
    title="No results yet"
    description="Run the query to see rows here."
  />
);

export const NoMatches = () => (
  <EmptyState
    icon={<Search />}
    title="Nothing matched"
    description="No file in this project contains that symbol."
  />
);

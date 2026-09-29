export interface CatalogItem {
  name: string;
  comment?: string | null;
}
export interface CatalogColumn extends CatalogItem {
  data_type: string;
}
export interface CatalogPage {
  items: CatalogItem[];
  next_page_token?: string;
}
export interface TableSelection {
  database: string;
  schema: string;
  table: string;
  columns: CatalogColumn[];
  timeColumn: string;
}

export interface Category {
  id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  category_id: number | null;
  category: Category | null;
  tags: Tag[];
}

export interface PostList {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  category: Category | null;
  tags: Tag[];
}

export interface SearchResult {
  items: PostList[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
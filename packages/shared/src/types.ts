// Firebase Timestamp-compatible type (avoids coupling shared package to firebase SDK)
export interface FirebaseTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Timestamp extends FirebaseTimestamp {}

export interface User {
  uid: string;
  displayName: string;
  email: string;
  phone?: string;
  photoURL?: string;
  role: "user" | "admin";
  subscription: UserSubscription | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserSubscription {
  planId: string;
  planName: string;
  status: "active" | "expired" | "cancelled";
  startDate: Timestamp;
  endDate: Timestamp;
  transactionId?: string;
}

export interface Content {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  banner: string;
  type: "movie" | "series";
  genre: string[];
  releaseDate: Timestamp;
  rating?: number;
  isTrending: boolean;
  isFeatured: boolean;
  requiredPlan: string;
  status: "draft" | "published";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Video {
  id: string;
  contentId: string;
  title: string;
  description?: string;
  duration: number;
  season?: number;
  episode?: number;
  videoUrl: string;
  storageRef: string;
  thumbnailUrl?: string;
  status: "processing" | "ready" | "failed";
  order: number;
  createdAt: Timestamp;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  duration: number; // days
  features: string[];
  order: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PaymentSettings {
  gatewayUrl: string;
  params: Record<string, string>;
}

export interface SiteSettings {
  siteName: string;
  logo: string;
  heroContentId?: string;
  heroTitle?: string;
  heroDescription?: string;
  requireSubscriptionToBrowse?: boolean;
}

export interface AnalyticsEntry {
  // IST calendar date (YYYY-MM-DD) the row represents.
  date: string;
  // ISO UTC instants bounding the IST day; helpful for verifying intent.
  windowStart?: string;
  windowEnd?: string;
  // Per-day deltas — counted within [windowStart, windowEnd).
  newUsers: number;
  newSubscriptions?: number;
  revenue?: number;
  revenueCurrency?: string;
  // Snapshots taken at windowEnd (the moment the aggregator ran).
  totalUsers: number;
  activeSubscriptions: number;
  totalPublishedContent: number;
}

export const GENRES = [
  "Action",
  "Comedy",
  "Drama",
  "Horror",
  "Romance",
  "Thriller",
  "Sci-Fi",
  "Documentary",
  "Animation",
  "Crime",
  "Mystery",
  "Fantasy",
] as const;

export type Genre = (typeof GENRES)[number];

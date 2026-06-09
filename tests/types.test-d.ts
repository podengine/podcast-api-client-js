/**
 * Compile-time type assertions. This file is intentionally not executed — it is checked by
 * `tsc` (pnpm type-check). If the generated types regress, type-check fails.
 */
import type { PodEngine } from '../src/index';
import type {
  GetLatestChartParams,
  GetLatestChartResponse,
  CreateGuestProfileParams,
  UpdateGuestProfileSocialMediaLinksParams,
} from '../src/generated/client';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

// Resolve a method's resolved return type.
type Returns<M> = M extends (...args: never[]) => Promise<infer R> ? R : never;

// Binary endpoints resolve to Blob.
type _BinaryIsBlob = Expect<Equal<Returns<PodEngine['episodes']['downloadEpisodeTranscript']>, Blob>>;

// JSON endpoints resolve to a concrete (non-any) data payload.
type ChartReturn = Returns<PodEngine['charts']['getLatestChart']>;
type _ChartNotAny = Expect<Equal<IsAny<ChartReturn>, false>>;
type _ChartResponseAlias = Expect<Equal<ChartReturn, GetLatestChartResponse>>;

// Query params are a real object type, not `any`.
type _ChartParamsNotAny = Expect<Equal<IsAny<GetLatestChartParams>, false>>;

// Object body params expose body fields directly.
type _CreateGuestHasShortBio = Expect<CreateGuestProfileParams extends { shortBio: string } ? true : false>;

// Array body params are supplied through a `body` field.
type _SocialLinksHasBodyField = Expect<
  UpdateGuestProfileSocialMediaLinksParams extends { body: unknown[] } ? true : false
>;

// Exercise the assertions so the aliases are considered "used".
export type _Assertions = [
  _BinaryIsBlob,
  _ChartNotAny,
  _ChartResponseAlias,
  _ChartParamsNotAny,
  _CreateGuestHasShortBio,
  _SocialLinksHasBodyField,
];

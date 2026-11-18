import type { ParkingFeature, SecurityFeature } from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import {
  Accessibility,
  Cctv,
  DoorClosed,
  Lightbulb,
  type LucideIcon,
  Ruler,
  Umbrella,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const ICONS: Record<ParkingFeature, LucideIcon> = {
  covered: Umbrella,
  evCharging: Zap,
  accessible: Accessibility,
};

/**
 * Feature labels with icons (the text carries the meaning; icons are decoration). `named={false}`
 * inside a description (`aria-describedby`): a list's own name would replace its items there, and
 * "Features" would be read instead of "Accessible space".
 */
export function FeatureBadges({
  features,
  named = true,
}: {
  features: ParkingFeature[];
  named?: boolean;
}) {
  const t = useTranslations('Features');
  if (features.length === 0) return null;
  return (
    <ul role="list" aria-label={named ? t('label') : undefined} className="flex flex-wrap gap-1.5">
      {features.map((feature) => {
        const Icon = ICONS[feature];
        return (
          <li key={feature}>
            <Badge variant="secondary">
              <Icon aria-hidden />
              {t(feature)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

const SECURITY_ICONS: Record<SecurityFeature, LucideIcon> = {
  cctv: Cctv,
  lit: Lightbulb,
  gated: DoorClosed,
};

/** What the whole listing offers for a car's safety (5A.1), as badges like the features'. */
export function SecurityBadges({
  security,
  named = true,
}: {
  /** Missing from a response written before it existed (a cached list, a deploy half done). */
  security?: SecurityFeature[] | undefined;
  named?: boolean;
}) {
  const t = useTranslations('Features');
  if (!security || security.length === 0) return null;
  return (
    <ul
      role="list"
      aria-label={named ? t('securityLabel') : undefined}
      className="flex flex-wrap gap-1.5"
    >
      {security.map((feature) => {
        const Icon = SECURITY_ICONS[feature];
        return (
          <li key={feature}>
            <Badge variant="secondary">
              <Icon aria-hidden />
              {t(feature)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The largest vehicle a space takes, in the limits the owner gave (5A.1). Nothing where they gave
 * none: a space with no stated limit is not one that takes any size, only one nobody measured.
 */
export function SpaceLimits({
  maxHeightCm,
  maxLengthCm,
  maxWidthCm,
  named = true,
}: {
  maxHeightCm?: number | null | undefined;
  maxLengthCm?: number | null | undefined;
  maxWidthCm?: number | null | undefined;
  named?: boolean;
}) {
  const t = useTranslations('Features');
  const limits = [
    maxHeightCm == null ? null : t('heightLimit', { value: maxHeightCm }),
    maxLengthCm == null ? null : t('lengthLimit', { value: maxLengthCm }),
    maxWidthCm == null ? null : t('widthLimit', { value: maxWidthCm }),
  ].filter((limit) => limit !== null);
  if (limits.length === 0) return null;
  return (
    <ul
      role="list"
      aria-label={named ? t('limitsLabel') : undefined}
      className="flex flex-wrap gap-1.5 text-sm text-muted-foreground"
    >
      {limits.map((limit, index) => (
        <li key={index} className="flex items-center gap-1">
          {index === 0 ? <Ruler aria-hidden className="size-3.5" /> : null}
          {limit}
        </li>
      ))}
    </ul>
  );
}

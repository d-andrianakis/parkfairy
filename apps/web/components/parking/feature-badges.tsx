import type { ParkingFeature } from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import { Accessibility, Umbrella, Zap, type LucideIcon } from 'lucide-react';
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
    <ul aria-label={named ? t('label') : undefined} className="flex flex-wrap gap-1.5">
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

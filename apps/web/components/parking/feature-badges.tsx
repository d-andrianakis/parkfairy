import type { ParkingFeature } from '@parkfairy/contracts';
import { Badge } from '@parkfairy/ui/components/badge';
import { Accessibility, Umbrella, Zap, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

const ICONS: Record<ParkingFeature, LucideIcon> = {
  covered: Umbrella,
  evCharging: Zap,
  accessible: Accessibility,
};

/** Feature labels with icons (the text carries the meaning; icons are decoration). */
export function FeatureBadges({ features }: { features: ParkingFeature[] }) {
  const t = useTranslations('Features');
  if (features.length === 0) return null;
  return (
    <ul aria-label={t('label')} className="flex flex-wrap gap-1.5">
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

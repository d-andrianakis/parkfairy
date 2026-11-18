/**
 * How a saved vehicle is named in a list: its nickname and plate, or the plate alone. The nickname
 * is the driver's own words, shown to the driver only.
 */
export function vehicleLabel({ name, plate }: { name: string | null; plate: string }): string {
  return name ? `${name} · ${plate}` : plate;
}

import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import { HAS_DATABASE, publishListing, setStay, unpublishListing } from '../support/db';
import { DEMO_DATA, EMAIL_OUTBOX, WEB_URL } from '../support/env';
import {
  expectAccessible,
  ownDriver,
  ownVisitor,
  registerAndSignIn,
  trackCspViolations,
  uniqueEmail,
} from '../support/fixtures';
import { athensDay, athensInstant, listingWithStaff } from '../support/listings';

// Feature: what a driver keeps for next time (5A.2). Saved vehicles, picked instead of typing a plate
// and checked against the space; favourite listings; and "Book again" on a stay that is over. All of
// it is the driver's own and private.

test.use(ownVisitor);

const headers = { origin: WEB_URL };
const stayPath = (slug: string, day: string) =>
  `/en/parking/${slug}?startDate=${day}&startTime=10:00&endDate=${day}&endTime=12:00`;

async function bookingOpen(page: Page, slug: string): Promise<boolean> {
  const response = await page.request.get(`/api/v1/parking/${slug}`);
  return ((await response.json()) as { bookingOpen: boolean }).bookingOpen;
}

/** The page's own status regions, said together: each form has one, and the page has one more. */
const said = (page: Page) => page.getByRole('status').allTextContents();

test('a driver saves, changes and forgets vehicles, and nobody else sees them', async ({
  browser,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.setTimeout(180_000);
  const { context, page } = await ownDriver(browser, 'vehicles');
  const other = await ownDriver(browser, 'vehicles-other');
  const csp = await trackCspViolations(page);

  try {
    // From the account page.
    await page.goto('/en/account');
    await page.getByRole('link', { name: 'Saved vehicles' }).click();
    await expect(page).toHaveURL('/en/account/vehicles');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saved vehicles');
    await expect(page.getByText('You haven’t saved a vehicle yet.')).toBeVisible();
    await expectAccessible(page);

    // Nothing sent for an empty form: the plate says so, and holds the focus.
    const form = page.getByRole('region', { name: 'Add a vehicle' });
    const plate = form.getByRole('textbox', { name: 'Number plate' });
    await form.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(plate).toBeFocused();
    await expect(plate).toHaveAttribute('aria-invalid', 'true');
    await expect(plate).toHaveAccessibleDescription(/Enter the number plate/);
    await expect(page.getByText('1 field needs your attention')).toBeAttached();
    await form.getByRole('textbox', { name: 'Height (cm)' }).fill('99');
    await form.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(form.getByRole('textbox', { name: 'Height (cm)' })).toHaveAccessibleDescription(
      'Enter a height from 100 to 500 cm',
    );
    await expectAccessible(page);

    // Saved as a Greek keyboard types it, kept as the car shows it, with its name and size.
    await plate.fill('ικβ-1234');
    await form.getByRole('textbox', { name: 'Name (optional)' }).fill('Work car');
    await form.getByRole('textbox', { name: 'Height (cm)' }).fill('190');
    await form.getByRole('textbox', { name: 'Length (cm)' }).fill('440');
    await form.getByRole('button', { name: 'Save vehicle' }).click();
    const list = page.getByRole('list', { name: 'Your saved vehicles' });
    const work = list.getByRole('listitem').filter({ hasText: 'IKB1234' });
    await expect(work).toContainText('Work car');
    await expect(work).toContainText('190 cm high, 440 cm long');
    await expect.poll(() => said(page)).toContain('Vehicle saved.');
    await expect(plate).toBeFocused();
    await expect(plate).toHaveValue('');

    // The same car typed another way is the same car.
    await plate.fill('IKB 1234');
    await form.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(plate).toHaveAccessibleDescription(/saved that plate already/);
    await expect(plate).toBeFocused();
    await plate.fill('YXA-9876');
    await form.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expectAccessible(page);

    // Reloaded, it is still there; in Greek, on a phone, nothing runs off the screen.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/el/account/vehicles');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Αποθηκευμένα οχήματα');
    await expect(page.getByText('IKB1234')).toBeVisible();
    await expect(page.getByText('ύψος 190 εκ., μήκος 440 εκ.')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.body.clientWidth),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/account/vehicles');

    // Changed in place: it opens on the plate, and the focus comes back to its button.
    await work.getByRole('button', { name: 'Edit Work car · IKB1234' }).click();
    const change = page.getByRole('form', { name: 'Change Work car · IKB1234' });
    await expect(change.getByRole('textbox', { name: 'Number plate' })).toBeFocused();
    await expect(change.getByRole('textbox', { name: 'Height (cm)' })).toHaveValue('190');
    await change.getByRole('textbox', { name: 'Name (optional)' }).fill('Old car');
    await change.getByRole('textbox', { name: 'Height (cm)' }).fill('');
    await expectAccessible(page);
    await change.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: 'Edit Old car · IKB1234' })).toBeFocused();
    await expect(list.getByRole('listitem').filter({ hasText: 'IKB1234' })).toContainText(
      '440 cm long',
    );
    await expect(list.getByRole('listitem').filter({ hasText: 'IKB1234' })).not.toContainText(
      '190 cm high',
    );

    // Another driver sees none of it, and can neither change nor remove it.
    const mine = (await (await page.request.get('/api/v1/vehicles')).json()) as {
      vehicles: { id: string; plate: string }[];
    };
    expect(mine.vehicles.map((vehicle) => vehicle.plate)).toEqual(['IKB1234', 'YXA9876']);
    const theirs = (await (await other.page.request.get('/api/v1/vehicles')).json()) as {
      vehicles: unknown[];
    };
    expect(theirs.vehicles).toEqual([]);
    const id = mine.vehicles[0]?.id ?? '';
    const stolen = await other.page.request.put(`/api/v1/vehicles/${id}`, {
      headers,
      data: { plate: 'AAA1111' },
    });
    expect(stolen.status()).toBe(404);
    expect((await other.page.request.delete(`/api/v1/vehicles/${id}`, { headers })).status()).toBe(
      404,
    );
    // Signed out, the page asks to sign in and the API says no.
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
    });
    const visitor = await anonymous.newPage();
    expect((await visitor.request.get('/api/v1/vehicles')).status()).toBe(401);
    await visitor.goto('/en/account/vehicles');
    await expect(visitor).toHaveURL(/\/en\/sign-in\?next=/);
    await anonymous.close();

    // Removed after asking, with the question focused; the list's heading takes the focus.
    await page.getByRole('button', { name: 'Remove Old car · IKB1234' }).click();
    await expect(page.getByText(/Remove Old car · IKB1234\? Bookings you made/)).toBeFocused();
    await page.getByRole('button', { name: 'No, keep it' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove Old car · IKB1234' }).click();
    await page.getByRole('button', { name: 'Yes, remove it' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Your saved vehicles' }),
    ).toBeFocused();
    await expect.poll(() => said(page)).toContain('Vehicle removed.');
    await expectAccessible(page);
    expect(await csp()).toEqual([]);
  } finally {
    await other.context.close();
    await context.close();
  }
});

test('a vehicle is checked against the space, saved from the booking page, and booked again', async ({
  browser,
  page,
}) => {
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.skip(!HAS_DATABASE, 'Putting a listing live is done by hand in the database');
  test.setTimeout(300_000);

  await registerAndSignIn(page, uniqueEmail('garage-owner'), 'Owner Garage');
  const name = `Γκαράζ οχημάτων ${randomUUID().slice(0, 6)}`;
  // One space that takes vehicles up to 200 cm high.
  const { id, slug } = await listingWithStaff(page, name, { maxHeightCm: 200 });
  await publishListing(id);
  const day = athensDay(17);
  const { context, page: driver } = await ownDriver(browser, 'garage-driver');
  const csp = await trackCspViolations(driver);

  try {
    test.skip(
      !(await bookingOpen(driver, slug)),
      'Bookings are confirmed without payment locally only',
    );
    // A tall vehicle and one with no size said, saved as the page would.
    const saved = async (body: object) =>
      expect((await driver.request.post('/api/v1/vehicles', { headers, data: body })).ok()).toBe(
        true,
      );
    await saved({ plate: 'ΙΚΒ-1234', name: 'Work car', heightCm: 250 });

    // The listing asks which vehicle, and says the space is too small for it, in words.
    await driver.goto(stayPath(slug, day));
    const picker = driver.getByRole('combobox', { name: 'Vehicle' });
    await expect(picker).toHaveValue(/[0-9a-f-]{36}/);
    await expect(driver.getByRole('radio', { name: 'K1' })).toHaveAccessibleDescription(
      /Too small for this vehicle/,
    );
    await expectAccessible(driver);
    await driver.getByRole('button', { name: 'Book this space' }).click();
    const refusal = driver.getByRole('region', { name: 'Choose your space' }).getByRole('alert');
    await expect(refusal).toHaveText(
      'That space is too small for Work car · IKB1234. Choose another space or vehicle.',
    );
    await expect(driver.getByRole('radio', { name: 'K1' })).toBeFocused();
    await expectAccessible(driver);

    // The API refuses it as well, whatever a page says (nothing is held).
    const space = (await (
      await driver.request.get(`/api/v1/parking/${slug}`, {
        params: { start: athensInstant(day, '10:00'), end: athensInstant(day, '12:00') },
      })
    ).json()) as { spaces: { id: string }[] };
    const { vehicles } = (await (await driver.request.get('/api/v1/vehicles')).json()) as {
      vehicles: { id: string }[];
    };
    const refused = await driver.request.post('/api/v1/bookings', {
      headers,
      data: {
        listing: slug,
        spaceId: space.spaces[0]?.id,
        start: athensInstant(day, '10:00'),
        end: athensInstant(day, '12:00'),
        vehicleId: vehicles[0]?.id,
      },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'VEHICLE_DOES_NOT_FIT' });

    // With no vehicle chosen it holds, and the booking page offers the saved one first: refused
    // again there, for the same reason, with the way back to choose.
    await picker.selectOption({ label: 'No saved vehicle' });
    await expect(refusal).toHaveCount(0);
    await driver.getByRole('button', { name: 'Book this space' }).click();
    await expect(driver).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    const bookingUrl = new URL(driver.url()).pathname;
    const car = driver.getByRole('combobox', { name: 'Vehicle' });
    await expect(car).toHaveAccessibleDescription('The owner will see this plate: IKB1234.');
    await expect(driver.getByRole('textbox', { name: 'Number plate' })).toHaveCount(0);
    await expectAccessible(driver);
    await driver.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(driver.getByRole('alert').filter({ hasText: 'too small' })).toContainText(
      'That space is too small for this vehicle. Choose another space.',
    );
    await expect(driver.getByRole('link', { name: 'Choose another space' })).toBeVisible();

    // Another vehicle: typed here, and saved for next time with one tick.
    await car.selectOption({ label: 'Another vehicle' });
    const plate = driver.getByRole('textbox', { name: 'Number plate' });
    await driver.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(plate).toBeFocused();
    await plate.fill('υχα-9876');
    await driver.getByRole('checkbox', { name: 'Save this vehicle for next time' }).check();
    await expectAccessible(driver);
    await driver.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(driver).toHaveURL(`${bookingUrl}?done=confirmed`);
    await expect(driver.getByText('YXA9876')).toBeVisible();
    const { vehicles: after } = (await (await driver.request.get('/api/v1/vehicles')).json()) as {
      vehicles: { plate: string }[];
    };
    expect(after.map((vehicle) => vehicle.plate)).toEqual(['IKB1234', 'YXA9876']);
    const reference =
      (
        await driver.getByText(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/).textContent()
      )?.trim() ?? '';

    // A stay that is not over has no "Book again".
    await expect(driver.getByRole('button', { name: 'Book again' })).toHaveCount(0);
    // Over, three days ago at the same hours: it is offered, saying which weekday and times.
    const earlier = athensDay(-3);
    await setStay(reference, {
      startsAt: new Date(athensInstant(earlier, '10:00')),
      endsAt: new Date(athensInstant(earlier, '12:00')),
    });
    await driver.goto('/en/bookings?when=past');
    const card = driver.getByRole('listitem').filter({ hasText: reference });
    const again = card.getByRole('button', { name: 'Book again' });
    await expect(again).toHaveAccessibleDescription(/^Same weekday and times: /);
    await expectAccessible(driver);

    // One press holds the same space for the same car; the page asks only to confirm.
    await again.click();
    await expect(driver).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
    expect(new URL(driver.url()).pathname).not.toBe(bookingUrl);
    await expect(driver.getByRole('heading', { level: 1 })).toHaveText('Complete your booking');
    await expect(driver.getByText(/We’re keeping space K1 for you until/)).toBeVisible();
    await expect(driver.getByRole('combobox', { name: 'Vehicle' })).toHaveAccessibleDescription(
      'The owner will see this plate: YXA9876.',
    );
    await driver.getByRole('button', { name: 'Let this space go' }).click();
    await driver.getByRole('button', { name: 'Yes, let it go' }).click();
    await expect(driver).toHaveURL(/released=1/);

    // The booking that is over offers it on its own page too, in Greek as well.
    await driver.goto(bookingUrl);
    await expect(driver.getByRole('button', { name: 'Book again' })).toBeVisible();
    await expectAccessible(driver);
    await driver.goto(bookingUrl.replace('/en/', '/el/'));
    await expect(driver.getByRole('button', { name: 'Νέα κράτηση' })).toBeVisible();
    await expectAccessible(driver);

    // Forgetting the vehicle keeps the booking's plate: it was copied onto the booking.
    const yxa = after.find((vehicle) => vehicle.plate === 'YXA9876') as { id?: string } | undefined;
    const { vehicles: listed } = (await (await driver.request.get('/api/v1/vehicles')).json()) as {
      vehicles: { id: string; plate: string }[];
    };
    const forget = listed.find((vehicle) => vehicle.plate === 'YXA9876');
    expect(yxa).toBeDefined();
    expect((await driver.request.delete(`/api/v1/vehicles/${forget?.id}`, { headers })).ok()).toBe(
      true,
    );
    await driver.goto(bookingUrl);
    await expect(driver.getByText('YXA9876')).toBeVisible();
    expect(await csp()).toEqual([]);
  } finally {
    await context.close();
    await unpublishListing(id);
  }
});

test('a driver keeps favourite listings, and only they see them', async ({ browser }) => {
  test.skip(!DEMO_DATA, 'needs the demo listings (pnpm db:seed)');
  test.skip(!EMAIL_OUTBOX, 'New accounts need their confirmation emails');
  test.setTimeout(180_000);
  const { context, page } = await ownDriver(browser, 'favourites');
  const other = await ownDriver(browser, 'favourites-other');
  const csp = await trackCspViolations(page);
  const slug = 'syntagma-square-garage';
  const garage = 'Γκαράζ Πλατείας Συντάγματος';

  try {
    // Signed out: no button, no page, no API.
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}` },
    });
    const visitor = await anonymous.newPage();
    await visitor.goto(`/en/parking/${slug}`);
    await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Favourite' })).toHaveCount(0);
    expect((await visitor.request.get('/api/v1/favourites')).status()).toBe(401);
    await visitor.goto('/en/favourites');
    await expect(visitor).toHaveURL(/\/en\/sign-in\?next=/);
    await anonymous.close();

    // Nothing yet.
    await page.goto('/en/favourites');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Favourite parking');
    await expect(page.getByText(/You haven’t saved any parking yet/)).toBeVisible();
    await expectAccessible(page);

    // Pressed on the listing, said once, and still pressed after a reload.
    await page.goto(`/en/parking/${slug}`);
    const heart = page.getByRole('button', { name: 'Favourite' });
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => said(page)).toContain('Saved to your favourites.');
    await expect(heart).toBeFocused();
    await expectAccessible(page);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // On the favourites page, from the account page, in both languages and on a phone.
    await page.goto('/en/account');
    await page.getByRole('link', { name: 'Favourite parking' }).click();
    await expect(page).toHaveURL('/en/favourites');
    const list = page.getByRole('list', { name: 'Your favourite parking' });
    await expect(list.getByRole('link', { name: garage })).toBeVisible();
    await expectAccessible(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/el/favourites');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Αγαπημένοι χώροι στάθμευσης');
    await expect(page.getByRole('link', { name: garage })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.body.clientWidth),
    ).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Another driver has none, and cannot change this one's.
    const theirs = (await (await other.page.request.get('/api/v1/favourites')).json()) as {
      listings: unknown[];
    };
    expect(theirs.listings).toEqual([]);
    await other.page.request.delete(`/api/v1/favourites/${slug}`, { headers });
    expect(
      (
        (await (await page.request.get(`/api/v1/favourites/${slug}`)).json()) as {
          favourite: boolean;
        }
      ).favourite,
    ).toBe(true);

    // Let go from the list: the page comes back saying so, and the notice takes the focus.
    await page.goto('/en/favourites');
    const remove = page
      .getByRole('list', { name: 'Your favourite parking' })
      .getByRole('button', { name: 'Remove from favourites' });
    await expect(remove).toHaveAccessibleDescription(garage);
    await remove.click();
    await expect(page).toHaveURL(/\/en\/favourites\?removed=/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Removed from your favourites.' }),
    ).toBeFocused();
    await expect(page.getByText(/You haven’t saved any parking yet/)).toBeVisible();
    await page.goto(`/en/parking/${slug}`);
    await expect(page.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await csp()).toEqual([]);
  } finally {
    await other.context.close();
    await context.close();
  }
});

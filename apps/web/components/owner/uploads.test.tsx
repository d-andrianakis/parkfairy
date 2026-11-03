import {
  deleteListingPhoto,
  deleteListingProof,
  reorderListingPhotos,
  saveListingProofDetails,
  updateListingPhoto,
} from '@parkfairy/api-client';
import type { OwnerPhoto, OwnerProof } from '@parkfairy/contracts';
import { expectNoAxeViolations } from '@parkfairy/ui/testing/axe';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_NAMESPACES } from '@/i18n/client-namespaces';
import { uploadFile } from '@/lib/owner-client';
import { answer, LISTING_ID, listingFixture, refusal } from '@/test/owner-fixtures';
import { rendererFor } from '@/test/render';
import { PhotosStep } from './photos-step';
import { ProofStep } from './proof-step';

const renderInSubtree = rendererFor(CLIENT_NAMESPACES.owner);

vi.mock('@parkfairy/api-client', () => ({
  client: { setConfig: vi.fn() },
  deleteListingPhoto: vi.fn(),
  deleteListingProof: vi.fn(),
  reorderListingPhotos: vi.fn(),
  saveListingProofDetails: vi.fn(),
  updateListingPhoto: vi.fn(),
}));
vi.mock('@/lib/owner-client', async (original) => ({
  ...(await original<typeof import('@/lib/owner-client')>()),
  uploadFile: vi.fn(),
}));
const upload = vi.mocked(uploadFile);

const photo = (id: string, overrides: Partial<OwnerPhoto> = {}): OwnerPhoto => ({
  id,
  key: id.repeat(32).slice(0, 32),
  width: 1600,
  height: 1067,
  alt: null,
  color: '#334455',
  ...overrides,
});
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const proof = (overrides: Partial<OwnerProof> = {}): OwnerProof => ({
  id: A,
  kind: 'lease',
  fileName: 'μισθωτήριο.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  createdAt: '2027-01-01T00:00:00.000Z',
  ...overrides,
});

const image = (name: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteListingPhoto).mockResolvedValue(answer(undefined) as never);
  vi.mocked(deleteListingProof).mockResolvedValue(answer(undefined) as never);
  vi.mocked(reorderListingPhotos).mockResolvedValue(answer(undefined) as never);
  vi.mocked(updateListingPhoto).mockResolvedValue(answer(undefined) as never);
  vi.mocked(saveListingProofDetails).mockResolvedValue(answer({}) as never);
});

describe('PhotosStep', () => {
  const chooser = () => screen.getByLabelText('Choose photos');

  it('hides Continue until there is a photo', async () => {
    const { container } = renderInSubtree(<PhotosStep listing={listingFixture()} />);
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('uploads what was chosen and adds it to the list', async () => {
    upload.mockResolvedValue({ ok: true, data: photo(A) });
    renderInSubtree(<PhotosStep listing={listingFixture()} />);
    await userEvent.upload(chooser(), image('garage.jpg'));

    expect(await screen.findByRole('img', { name: 'Photo 1 of your parking' })).toBeInTheDocument();
    expect(upload.mock.calls[0]?.[0]).toBe(`/api/v1/owner/listings/${LISTING_ID}/photos`);
    expect(await screen.findByText('1 photo added')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument();
  });

  it('uploads one at a time and reports each failure by name', async () => {
    upload
      .mockResolvedValueOnce({ ok: true, data: photo(A) })
      .mockResolvedValueOnce({ ok: false, failure: { code: 'PHOTO_TOO_SMALL' } });
    renderInSubtree(<PhotosStep listing={listingFixture()} />);
    await userEvent.upload(chooser(), [image('one.jpg'), image('two.jpg')]);

    expect(await screen.findByText(/two\.jpg: This photo is too small/)).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('refuses a huge file without sending it', async () => {
    renderInSubtree(<PhotosStep listing={listingFixture()} />);
    await userEvent.upload(chooser(), image('huge.jpg', 10 * 1024 * 1024 + 1));
    expect(await screen.findByText('huge.jpg is over 10 MB.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('marks the first photo as the cover', () => {
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [photo(A), photo(B)] })} />);
    expect(screen.getAllByText('Cover')).toHaveLength(1);
  });

  it('reorders by button, so no one needs to drag, and says where it went', async () => {
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [photo(A), photo(B)] })} />);
    // aria-disabled, not disabled: a move to the end mustn't drop the focus from the button.
    const first = screen.getByRole('button', { name: 'Move photo 1 earlier' });
    expect(first).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(first);
    expect(reorderListingPhotos).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));

    await waitFor(() =>
      expect(reorderListingPhotos).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: { ids: [B, A] },
      }),
    );
    expect(await screen.findByText('Now photo 1 of 2')).toBeInTheDocument();
  });

  it('puts the order back if the server refuses it', async () => {
    vi.mocked(reorderListingPhotos).mockResolvedValue(refusal('PHOTOS_CHANGED') as never);
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [photo(A), photo(B)] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));
    expect(await screen.findByText(/changed in another window/)).toBeInTheDocument();
    const [first] = screen.getAllByRole('img');
    expect(first).toHaveAttribute('src', expect.stringContaining('aaaa'));
  });

  it('saves a description as the owner leaves it, in the listing’s language', async () => {
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [photo(A)] })} />);
    const field = screen.getByLabelText('What photo 1 shows (optional)');
    expect(field).toHaveAttribute('lang', 'el');
    await userEvent.type(field, 'Η είσοδος');
    await userEvent.tab();
    await waitFor(() =>
      expect(updateListingPhoto).toHaveBeenCalledWith({
        path: { id: LISTING_ID, photoId: A },
        body: { alt: 'Η είσοδος' },
      }),
    );
  });

  it('uses the owner’s description as the image’s text', () => {
    const described = photo(A, { alt: 'Η είσοδος' });
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [described] })} />);
    expect(screen.getByRole('img', { name: 'Η είσοδος' })).toBeInTheDocument();
  });

  it('removes a photo and keeps the focus on the page', async () => {
    renderInSubtree(<PhotosStep listing={listingFixture({ photos: [photo(A)] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('Choose photos')).toHaveFocus());
  });

  it('closes the chooser once a listing has all its photos', () => {
    const photos = Array.from({ length: 10 }, (_, i) =>
      photo(`${String(i).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`),
    );
    renderInSubtree(<PhotosStep listing={listingFixture({ photos })} />);
    expect(screen.getByLabelText('Choose photos')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ProofStep', () => {
  const chooser = () => screen.getByLabelText('Choose a file');
  const pdf = new File(['%PDF-1.7'], 'lease.pdf', { type: 'application/pdf' });

  it('says who can see the document, and passes axe', async () => {
    const { container } = renderInSubtree(<ProofStep listing={listingFixture()} />);
    expect(screen.getByText(/never shown to drivers/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('sends the kind and the file’s name along', async () => {
    upload.mockResolvedValue({ ok: true, data: proof() });
    renderInSubtree(<ProofStep listing={listingFixture()} />);
    await userEvent.selectOptions(screen.getByLabelText('Kind of document'), 'lease');
    await userEvent.upload(chooser(), pdf);

    expect(await screen.findByRole('heading', { name: 'Your documents' })).toBeInTheDocument();
    const url = new URL(upload.mock.calls[0]?.[0] ?? '', 'http://localhost');
    expect(url.pathname).toBe(`/api/v1/owner/listings/${LISTING_ID}/proofs`);
    expect(url.searchParams.get('kind')).toBe('lease');
    // A file's name can say whose it is, so it stays out of the URL and so out of logs.
    expect(url.search).not.toContain('lease.pdf');
    expect(upload.mock.calls[0]?.[3]).toEqual({ 'X-File-Name': 'lease.pdf' });
  });

  it('shows why an upload was refused', async () => {
    upload.mockResolvedValue({ ok: false, failure: { code: 'FILE_TYPE_NOT_ALLOWED' } });
    renderInSubtree(<ProofStep listing={listingFixture()} />);
    await userEvent.upload(chooser(), pdf);
    expect(await screen.findByText(/isn’t accepted/)).toBeInTheDocument();
  });

  it('refuses a huge file without sending it', async () => {
    renderInSubtree(<ProofStep listing={listingFixture()} />);
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(chooser(), huge);
    expect(await screen.findByText('That file is over 10 MB.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('offers the document back, named, and small files read in KB', () => {
    renderInSubtree(<ProofStep listing={listingFixture({ proofs: [proof()] })} />);
    const link = screen.getByRole('link', { name: 'Download μισθωτήριο.pdf' });
    expect(link).toHaveAttribute('href', `/api/v1/owner/listings/${LISTING_ID}/proofs/${A}`);
    expect(screen.getByText(/2 kB|2 KB/)).toBeInTheDocument();
  });

  it('removes a document and keeps the focus on the page', async () => {
    renderInSubtree(<ProofStep listing={listingFixture({ proofs: [proof()] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove μισθωτήριο.pdf' }));
    await waitFor(() => expect(deleteListingProof).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(chooser()).toHaveFocus());
  });

  it('shows a land registry number it can’t accept on the field', async () => {
    renderInSubtree(<ProofStep listing={listingFixture()} />);
    const field = screen.getByLabelText(/Land registry number/);
    await userEvent.type(field, '<nope>');
    await userEvent.tab();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(saveListingProofDetails).not.toHaveBeenCalled();
  });

  it('saves the land registry number as the owner leaves it', async () => {
    renderInSubtree(<ProofStep listing={listingFixture()} />);
    await userEvent.type(screen.getByLabelText(/Land registry number/), '050681726008');
    await userEvent.tab();
    await waitFor(() =>
      expect(saveListingProofDetails).toHaveBeenCalledWith({
        path: { id: LISTING_ID },
        body: { landRegistrationNumber: '050681726008' },
      }),
    );
  });

  it('closes the chooser once a listing has all its documents', () => {
    const proofs = Array.from({ length: 5 }, (_, i) =>
      proof({ id: `${String(i).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }),
    );
    renderInSubtree(<ProofStep listing={listingFixture({ proofs })} />);
    expect(chooser()).toHaveAttribute('aria-disabled', 'true');
  });
});

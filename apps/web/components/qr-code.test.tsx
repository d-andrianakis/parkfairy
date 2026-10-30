import { render, screen } from '@testing-library/react';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QrCode } from './qr-code';

const URI = 'otpauth://totp/Parkfairy:demo%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Parkfairy';

describe('QrCode', () => {
  it('is one named image', () => {
    render(<QrCode value={URI} label="QR code for your authenticator app" />);
    const image = screen.getByRole('img', { name: 'QR code for your authenticator app' });
    expect(image.tagName.toLowerCase()).toBe('svg');
  });

  it('draws one square per dark module, dark on a light quiet zone in any theme', () => {
    const { container } = render(<QrCode value={URI} label="QR" />);
    const { data } = encode(URI, { border: 2 });
    const darkModules = data.flat().filter(Boolean).length;

    expect(container.querySelector('svg')).toHaveAttribute(
      'viewBox',
      `0 0 ${data.length} ${data.length}`,
    );
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#ffffff');
    const path = container.querySelector('path');
    expect(path).toHaveAttribute('fill', '#000000');
    expect(path?.getAttribute('d')?.match(/M/g)).toHaveLength(darkModules);
    // The quiet zone is light: nothing is drawn in the first row.
    expect(path?.getAttribute('d')).not.toMatch(/M\d+ 0h/);
  });
});

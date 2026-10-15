import { Test } from '@nestjs/testing';
import { WhatsAppClientService } from '../src/whatsapp/whatsapp-client.service';
import { WhatsAppCustomerMessenger } from '../src/whatsapp/whatsapp-customer-messenger';

describe('WhatsAppCustomerMessenger', () => {
  const sendText = jest.fn().mockResolvedValue(undefined);
  let messenger: WhatsAppCustomerMessenger;

  beforeEach(async () => {
    sendText.mockClear();
    const mod = await Test.createTestingModule({
      providers: [
        WhatsAppCustomerMessenger,
        { provide: WhatsAppClientService, useValue: { sendText } },
      ],
    }).compile();
    messenger = mod.get(WhatsAppCustomerMessenger);
  });

  it('sends the confirmation text unchanged', async () => {
    await messenger.bookingConfirmed('+919800000001', 'BK0001');
    expect(sendText).toHaveBeenCalledWith(
      '+919800000001',
      '✅ Payment received! Booking BK0001 is confirmed. See you on the venue!',
    );
  });

  it('sends the cancellation text with a coin refund line', async () => {
    await messenger.bookingCancelled('+919800000001', 'BK0001', '250');
    expect(sendText).toHaveBeenCalledWith(
      '+919800000001',
      '✅ Booking BK0001 cancelled.\n🪙 250 Coins credited.',
    );
  });

  it('sends the cancellation text without a refund line when nothing was paid', async () => {
    await messenger.bookingCancelled('+919800000001', 'BK0001');
    expect(sendText).toHaveBeenCalledWith('+919800000001', '✅ Booking BK0001 cancelled.');
  });
});

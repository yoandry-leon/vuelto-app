import { actionSheetController, alertController } from '@ionic/vue';
import { ACCOUNT_KIND, type Account } from '@/domain/accounts';
import type { PaymentMethod } from '@/domain/types';
import { useFinanzasStore } from '@/stores/finanzas';

const KINDS: PaymentMethod[] = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Otro'];

/** "¿Qué tipo de cuenta es?": efectivo, débito, crédito, transferencia u otro. */
export async function askAccountKind(header: string): Promise<PaymentMethod | undefined> {
  let picked: PaymentMethod | undefined;
  const sheet = await actionSheetController.create({
    header,
    buttons: [
      ...KINDS.map((k) => ({ text: ACCOUNT_KIND[k].charAt(0).toUpperCase() + ACCOUNT_KIND[k].slice(1), handler: () => void (picked = k) })),
      { text: 'Cancelar', role: 'cancel' },
    ],
  });
  await sheet.present();
  await sheet.onDidDismiss();
  return picked;
}

/** El nombre de una cuenta ("BROU débito"), nuevo o para cambiarlo. */
export async function askAccountName(header: string, value = ''): Promise<string | undefined> {
  const alert = await alertController.create({
    header,
    inputs: [{ name: 'name', type: 'text', value, placeholder: 'BROU débito, Visa Itaú, Efectivo…' }],
    buttons: [{ text: 'Cancelar', role: 'cancel' }, { text: 'Listo', role: 'confirm' }],
  });
  await alert.present();
  const { role, data } = await alert.onDidDismiss<{ values: { name: string } }>();
  const name = data?.values.name.trim();
  return role === 'confirm' && name ? name : undefined;
}

/** "+ Nueva cuenta": el nombre y después el tipo. */
export async function createAccount(): Promise<Account | undefined> {
  const name = await askAccountName('Nueva cuenta');
  if (!name) return undefined;
  const payment = await askAccountKind(`¿Qué tipo de cuenta es ${name}?`);
  if (!payment) return undefined;
  return useFinanzasStore().addAccount({ name, payment });
}

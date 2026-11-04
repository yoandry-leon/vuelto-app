import { decodeText } from '@/domain/statement';

export interface PickedStatement {
  name: string;
  text: string;
}

/**
 * Abre el selector de archivos para el extracto del banco: un CSV, o la tabla .xls que bajan algunos bancos.
 * Hay que llamarla en el mismo toque del botón: el navegador no abre el selector después de un `await`.
 */
export function pickStatementFile(): Promise<PickedStatement | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.xls,text/csv,text/comma-separated-values,text/plain,application/vnd.ms-excel';
    input.addEventListener('cancel', () => resolve(undefined), { once: true });
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (!file) return resolve(undefined);
        file.arrayBuffer().then(
          (bytes) => resolve({ name: file.name, text: decodeText(bytes) }),
          () => resolve(undefined),
        );
      },
      { once: true },
    );
    input.click();
  });
}

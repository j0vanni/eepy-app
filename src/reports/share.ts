/**
 * Turns the pure export builders (src/engine/export.ts) into files the user can keep or send:
 * a PDF via expo-print + the Android share sheet, a CSV via expo-file-system + the share sheet.
 * On web the report opens in a new tab to print / save as PDF, and the CSV downloads.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** A4 at 72 dpi, the unit expo-print uses for page size. */
const A4 = { width: 595, height: 842 };

export type ShareOutcome = 'shared' | 'opened' | 'downloaded';

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Web: opens the report in a new tab and starts printing ("Save as PDF"). Must be called straight
 * from a tap handler, before any `await`, or the browser blocks the new tab (then it downloads the HTML).
 */
function openReportOnWeb(html: string, fileBase: string): ShareOutcome {
  const w = window.open('', '_blank');
  if (!w) {
    download(`${fileBase}.html`, html, 'text/html');
    return 'downloaded';
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // The report stays open; the user can print from the browser menu.
    }
  }, 400);
  return 'opened';
}

async function shareFile(uri: string, mimeType: string, UTI: string, dialogTitle: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType, UTI, dialogTitle });
}

/** Renders the HTML report to an A4 PDF and opens the share sheet. */
export async function shareReportPdf(html: string, fileBase: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') return openReportOnWeb(html, fileBase);
  const { uri } = await Print.printToFileAsync({ html, ...A4 });
  // expo-print writes a random name into the cache; give it a readable one for the share target.
  let target = uri;
  try {
    const named = new File(Paths.cache, `${fileBase}.pdf`);
    if (named.exists) named.delete();
    await new File(uri).move(named);
    target = named.uri;
  } catch {
    // Sharing the original file is fine too.
  }
  await shareFile(target, 'application/pdf', 'com.adobe.pdf', 'Share your sleep report');
  return 'shared';
}

/** Writes the CSV (UTF-8 with BOM, so spreadsheet apps detect the encoding) and opens the share sheet. */
export async function shareCsv(csv: string, fileName: string): Promise<ShareOutcome> {
  const content = `﻿${csv}`;
  if (Platform.OS === 'web') {
    download(fileName, content, 'text/csv;charset=utf-8');
    return 'downloaded';
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.writeSync(content);
  await shareFile(file.uri, 'text/csv', 'public.comma-separated-values-text', 'Export your nights');
  return 'shared';
}

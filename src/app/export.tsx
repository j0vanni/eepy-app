/**
 * Reports: every night as a spreadsheet (CSV) and a printable sleep report (PDF).
 *
 * The CSV has two ways out, because the share sheet only works when some app on the phone accepts
 * the file: "Save to a folder" writes it where you choose with Android's own folder picker, "Share"
 * hands it to another app. Whatever happens (saved, cancelled, an error) is shown on the screen.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { allNights, buildReportData, exportNightsCsv, NIGHT_CSV_COLUMNS, reportFileBase, reportHtml } from '@/engine/export';
import { dateKey, formatDuration } from '@/engine/time';
import { saveTextToFolder } from '@/integrations/backup';
import { shareCsv, shareReportPdf } from '@/reports/share';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, Empty, Fold, Hero, ListCard, ListRow, Note, Row, Screen, Section, Segmented, Stat } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { font, scoreColor, space } from '@/ui/theme';

const PERIODS = [
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

/** Spreadsheet apps need the byte-order mark to read the file as UTF-8. */
const BOM = '﻿';

interface Status {
  tone: 'good' | 'info' | 'bad';
  text: string;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function StatusNote({ status }: { status?: Status }) {
  return status ? <Note tone={status.tone}>{status.text}</Note> : null;
}

export default function ExportScreen() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const cbti = useStore((s) => s.cbti);
  const preferredOrigins = useStore((s) => s.settings.preferredOrigins);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<'pdf' | 'save' | 'share' | undefined>();
  const [csvStatus, setCsvStatus] = useState<Status>();
  const [pdfStatus, setPdfStatus] = useState<Status>();

  const report = useMemo(() => (a ? buildReportData(a, data, { days, cbti }) : undefined), [a, data, days, cbti]);
  // Every night on the phone, not just the analysis window.
  const nights = useMemo(() => (a ? allNights(data, a.now, preferredOrigins) : []), [a, data, preferredOrigins]);
  const nightCount = nights.length;
  const firstNight = nights[0]?.wakeDate;
  const web = Platform.OS === 'web';

  if (!a || !report) {
    return (
      <Screen>
        <Empty icon="file-chart-outline" title="Nothing to export yet" body="Reports appear once eepy has some nights from your watch or the journal.">
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }

  const csvName = () => `eepy-nights-${dateKey(Date.now())}.csv`;

  const saveCsv = async () => {
    setBusy('save');
    setCsvStatus(undefined);
    try {
      const name = csvName();
      const outcome = await saveTextToFolder(name, `${BOM}${exportNightsCsv(a, data, nights)}`, 'text/csv');
      setCsvStatus(
        outcome === 'cancelled'
          ? { tone: 'info', text: 'Cancelled. Nothing was saved.' }
          : { tone: 'good', text: web ? `Downloaded ${name}.` : `Saved ${name} to the folder you picked.` },
      );
    } catch (e) {
      setCsvStatus({ tone: 'bad', text: `Couldn't save the file. ${errorText(e)}` });
    } finally {
      setBusy(undefined);
    }
  };

  const shareCsvFile = async () => {
    setBusy('share');
    setCsvStatus(undefined);
    try {
      const outcome = await shareCsv(exportNightsCsv(a, data, nights), csvName());
      setCsvStatus(
        outcome === 'downloaded'
          ? { tone: 'good', text: `Downloaded ${nightCount} nights as CSV.` }
          : { tone: 'info', text: 'The share sheet was opened. If no app there took the file, use "Save to a folder".' },
      );
    } catch (e) {
      setCsvStatus({ tone: 'bad', text: `Couldn't share the file. ${errorText(e)} Try "Save to a folder".` });
    } finally {
      setBusy(undefined);
    }
  };

  const makePdf = () => {
    setPdfStatus(undefined);
    let pending: ReturnType<typeof shareReportPdf>;
    try {
      // Build and hand over synchronously: on web the new tab must open inside the tap.
      pending = shareReportPdf(reportHtml(report), reportFileBase(report));
    } catch (e) {
      setPdfStatus({ tone: 'bad', text: `Couldn't create the report. ${errorText(e)}` });
      return;
    }
    setBusy('pdf');
    pending
      .then((r) =>
        setPdfStatus(
          r === 'opened'
            ? { tone: 'good', text: 'Report opened in a new tab. Use Print → Save as PDF.' }
            : r === 'downloaded'
              ? { tone: 'info', text: 'Pop-ups are blocked, so the report was downloaded as a web page. Open it and print to PDF.' }
              : { tone: 'info', text: 'The report was made and the share sheet opened. Pick Drive, Files or email there to keep it.' },
        ),
      )
      .catch((e: unknown) => setPdfStatus({ tone: 'bad', text: `Couldn't create the report. ${errorText(e)}` }))
      .finally(() => setBusy(undefined));
  };

  const avgVsNeed = report.avgSleepMin !== undefined ? report.avgSleepMin - report.need.needMin : undefined;

  return (
    <Screen subtitle="Files are made on this phone and only leave it when you send them.">
      <Hero
        label="Every night, as a spreadsheet"
        value={String(nightCount)}
        unit={nightCount === 1 ? 'night' : 'nights'}
        caption={`${firstNight ? `Since ${dayLabel(firstNight)}. ` : ''}One row a night (a CSV file), for Sheets, Excel or Numbers.`}
      />
      <View style={{ gap: space.sm, marginBottom: space.md }}>
        <Button label={busy === 'save' ? 'Saving…' : web ? 'Download CSV' : 'Save to a folder'} icon={web ? 'download' : 'folder-download-outline'} onPress={saveCsv} disabled={!!busy} />
        {web ? null : <Button kind="secondary" label={busy === 'share' ? 'Opening…' : 'Share'} icon="share-variant-outline" onPress={shareCsvFile} disabled={!!busy} />}
      </View>
      <StatusNote status={csvStatus} />

      <Section title="Sleep report (PDF)">
        <Segmented options={PERIODS} value={days} onChange={setDays} />
        <Card style={{ marginTop: space.md }}>
          <Row>
            <Stat
              label="Average sleep"
              value={report.avgSleepMin !== undefined ? formatDuration(report.avgSleepMin) : '–'}
              sub={avgVsNeed !== undefined ? `${avgVsNeed >= 0 ? '+' : '−'}${formatDuration(Math.abs(avgVsNeed))} vs need` : undefined}
            />
            <Stat label="Average score" value={report.avgScore !== undefined ? String(Math.round(report.avgScore)) : '–'} color={report.avgScore !== undefined ? scoreColor(report.avgScore) : undefined} />
            <Stat label="Nights" value={`${report.nightsRecorded}/${report.days}`} />
          </Row>
          <Text style={[font.small, { marginTop: space.md }]}>
            {dayLabel(report.from)} – {dayLabel(report.to)}. For you or an appointment: your averages against your sleep need, score, sleep debt, regularity, body clock, top insights, self-checks
            {cbti?.active ? ', your insomnia programme' : ''}, three charts and a night-by-night table.
          </Text>
          <View style={{ marginTop: space.md }}>
            <Button kind="secondary" label={busy === 'pdf' ? 'Creating report…' : web ? 'Open printable report' : 'Create and share PDF'} icon="file-pdf-box" onPress={makePdf} disabled={!!busy} />
          </View>
        </Card>
        <StatusNote status={pdfStatus} />
      </Section>

      <Section title="Good to know">
        <ListCard>
          <Fold bare title="What is in the files">
            <Text style={font.small}>The spreadsheet has these columns:</Text>
            <Text style={[font.tiny, { marginTop: space.xs }]}>{NIGHT_CSV_COLUMNS.join(' · ')}</Text>
            <Text style={[font.small, { marginTop: space.md }]}>
              Times are in this phone&apos;s time zone. Sleep stages, heart rate, HRV and oxygen are your watch&apos;s estimates through Health Connect, not a medical test.
            </Text>
            <Text style={[font.small, { marginTop: space.sm }]}>The report&apos;s tables use 24-hour times and A4 pages.</Text>
          </Fold>
          <ListRow
            icon="backup-restore"
            title="Full backup"
            sub="A file you can restore later is under Watch and data"
            onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'data' } })}
          />
        </ListCard>
      </Section>
    </Screen>
  );
}

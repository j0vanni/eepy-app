import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { allNights, buildReportData, exportNightsCsv, NIGHT_CSV_COLUMNS, reportFileBase, reportHtml } from '@/engine/export';
import { dateKey, formatDuration } from '@/engine/time';
import { shareCsv, shareReportPdf } from '@/reports/share';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Empty, Note, Row, Screen, Section, Segmented, Stat } from '@/ui/components';
import { notify } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

const PERIODS = [
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

export default function ExportScreen() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const cbti = useStore((s) => s.cbti);
  const preferredOrigins = useStore((s) => s.settings.preferredOrigins);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<'pdf' | 'csv' | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const report = useMemo(() => (a ? buildReportData(a, data, { days, cbti }) : undefined), [a, data, days, cbti]);
  // Every night on the phone, not just the analysis window.
  const nights = useMemo(() => (a ? allNights(data, a.now, preferredOrigins) : []), [a, data, preferredOrigins]);
  const nightCount = nights.length;
  const firstNight = nights[0]?.wakeDate;

  if (!a || !report) {
    return (
      <Screen>
        <Empty icon="file-chart-outline" title="Nothing to export yet" body="Reports and exports appear once eepy has some nights from your watch or the journal.">
          <Button label="Connect your watch" icon="watch" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }

  const makePdf = () => {
    // Build synchronously: on web the new tab must open inside the tap.
    const html = reportHtml(report);
    setBusy('pdf');
    setStatus(undefined);
    shareReportPdf(html, reportFileBase(report))
      .then((r) =>
        setStatus(
          r === 'opened'
            ? 'Report opened in a new tab. Use Print → Save as PDF.'
            : r === 'downloaded'
              ? 'Pop-ups are blocked, so the report was downloaded as a web page. Open it and print to PDF.'
              : undefined,
        ),
      )
      .catch((e: unknown) => notify("Couldn't create the report", e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(undefined));
  };

  const makeCsv = () => {
    const csv = exportNightsCsv(a, data, nights);
    setBusy('csv');
    setStatus(undefined);
    shareCsv(csv, `eepy-nights-${dateKey(Date.now())}.csv`)
      .then((r) => setStatus(r === 'downloaded' ? `Downloaded ${nightCount} nights as CSV.` : undefined))
      .catch((e: unknown) => notify("Couldn't export the nights", e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(undefined));
  };

  const avgVsNeed = report.avgSleepMin !== undefined ? report.avgSleepMin - report.need.needMin : undefined;

  return (
    <Screen>
      <Text style={[font.small, { marginBottom: space.md }]}>
        Keep a record of your sleep, or bring it to an appointment. Files are made on this phone and only leave it when you choose where to send them.
      </Text>

      <Card>
        <CardTitle icon="file-pdf-box" title="Sleep report (PDF)" />
        <Segmented options={PERIODS} value={days} onChange={setDays} />
        <Row style={{ marginTop: space.md }}>
          <Stat
            label="Avg sleep"
            value={report.avgSleepMin !== undefined ? formatDuration(report.avgSleepMin) : '–'}
            sub={avgVsNeed !== undefined ? `${avgVsNeed >= 0 ? '+' : '−'}${formatDuration(Math.abs(avgVsNeed))} vs need` : undefined}
          />
          <Stat
            label="Avg score"
            value={report.avgScore !== undefined ? String(Math.round(report.avgScore)) : '–'}
            color={report.avgScore !== undefined ? scoreColor(report.avgScore) : undefined}
          />
          <Stat label="Nights" value={`${report.nightsRecorded}/${report.days}`} />
        </Row>
        <Text style={[font.small, { marginTop: space.md }]}>
          {dayLabel(report.from)} – {dayLabel(report.to)}. Includes your averages against your sleep need, score, sleep debt, regularity (SRI), chronotype, top insights, self-checks
          {cbti?.active ? ', your insomnia programme' : ''}, three charts and a night-by-night table.
        </Text>
        <View style={{ marginTop: space.md }}>
          <Button
            label={busy === 'pdf' ? 'Creating report…' : Platform.OS === 'web' ? 'Open printable report' : 'Create & share PDF'}
            icon="file-pdf-box"
            onPress={makePdf}
            disabled={!!busy}
          />
        </View>
      </Card>

      <Card>
        <CardTitle icon="table-arrow-down" title="Every night (CSV)" />
        <Text style={font.body}>
          {nightCount} night{nightCount === 1 ? '' : 's'}
          {firstNight ? ` since ${dayLabel(firstNight)}` : ''}, one row each, for Sheets, Excel or Numbers.
        </Text>
        <Text style={[font.tiny, { marginTop: space.sm, lineHeight: 15 }]}>{NIGHT_CSV_COLUMNS.join(' · ')}</Text>
        <View style={{ marginTop: space.md }}>
          <Button label={busy === 'csv' ? 'Exporting…' : Platform.OS === 'web' ? 'Download CSV' : 'Export & share CSV'} icon="table-arrow-down" kind="secondary" onPress={makeCsv} disabled={!!busy} />
        </View>
      </Card>

      {status ? (
        <Note tone="good" icon="check-circle-outline">
          {status}
        </Note>
      ) : null}

      <Section title="Good to know">
        <Note tone="info">
          Times are in this phone&apos;s time zone. Sleep stages, heart rate, HRV and SpO₂ are your CMF Watch&apos;s estimates via Health Connect, not a medical test.
        </Note>
        <Note tone="info" icon="backup-restore">
          For a full backup you can restore later, use Settings → Your data → Export backup.
        </Note>
      </Section>
      <Text style={[font.tiny, { color: colors.textFaint, marginTop: space.sm }]}>Report tables use 24-hour times and A4 pages.</Text>
    </Screen>
  );
}

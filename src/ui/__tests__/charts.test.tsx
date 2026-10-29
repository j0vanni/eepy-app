/**
 * Smoke tests for the animated components and chart scrubbing. They pass whether reanimated runs
 * (with its Jest resolver) or the static fallback in motion.tsx is used.
 */
import { act } from 'react';
import { Text } from 'react-native';
import { createRoot, Root, TestInstance } from 'test-renderer';

import { DurationBars, LineChart } from '../charts';
import { Card, Meter, Ring } from '../components';

let root: Root;
beforeEach(() => {
  jest.useFakeTimers();
  root = createRoot();
});
afterEach(async () => {
  await act(async () => root.unmount());
  jest.useRealTimers();
});

const render = async (el: React.ReactElement) => {
  await act(async () => root.render(el));
};
const text = () => JSON.stringify(root.container.toJSON());
const byLabel = (label: string) => root.container.queryAll((i) => i.props.accessibilityLabel === label)[0];

/** ChartFrame waits for its width; hand it one. */
async function layout(width: number) {
  const frames = root.container.queryAll((i: TestInstance) => typeof i.props.onLayout === 'function' && i.props.style?.width === '100%');
  await act(async () => {
    for (const f of frames) f.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } } });
  });
}

/** A responder event for a single finger at x that started (and was last seen) at `from`. */
function touch(x: number, t: number, from = x) {
  const track = { touchActive: true, startPageX: from, startPageY: 50, startTimeStamp: 0, currentPageX: x, currentPageY: 50, currentTimeStamp: t, previousPageX: from, previousPageY: 50, previousTimeStamp: t - 1 };
  return {
    nativeEvent: { locationX: x, locationY: 50, pageX: x, pageY: 50, touches: [], changedTouches: [], identifier: 0, timestamp: t, target: 0 },
    touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t, touchBank: [track] },
  };
}

/** A quick tap at x on a scrub surface. */
async function tap(surface: TestInstance, x: number) {
  await act(async () => {
    surface.props.onResponderGrant(touch(x, 1));
    surface.props.onResponderRelease(touch(x, 2));
  });
}

describe('animated components', () => {
  it('render their content', async () => {
    await render(
      <Card onPress={() => undefined}>
        <Ring value={72}>
          <Text>72</Text>
        </Ring>
        <Meter value={30} />
        <Text>card body</Text>
      </Card>,
    );
    expect(text()).toContain('card body');
    expect(text()).toContain('72');
  });
});

describe('chart scrubbing', () => {
  const labels = ['M', 'T', 'W', 'T', 'F'];
  const tips = ['Mon 19 Oct', 'Tue 20 Oct', 'Wed 21 Oct', 'Thu 22 Oct', 'Fri 23 Oct'];

  it('shows the tapped point of a line chart', async () => {
    await render(<LineChart values={[10, 20, undefined, 40, 50]} labels={labels} tooltipLabels={tips} tooltipFormat={(v) => `${v} pts`} />);
    await layout(330);
    // Plot spans 30 → 330 px: x = 255 is the 4th point.
    await tap(byLabel('Trend chart'), 255);
    expect(text()).toContain('Thu 22 Oct');
    expect(text()).toContain('40 pts');
    // The readout clears itself after a moment.
    await act(async () => jest.advanceTimersByTime(3000));
    expect(text()).not.toContain('Thu 22 Oct');
  });

  it('reports missing points', async () => {
    await render(<LineChart values={[10, 20, undefined, 40, 50]} labels={labels} tooltipLabels={tips} />);
    await layout(330);
    await tap(byLabel('Trend chart'), 180);
    expect(text()).toContain('Wed 21 Oct');
    expect(text()).toContain('No data');
  });

  it('opens a bar on tap, but only when it has data', async () => {
    const onPressBar = jest.fn();
    const data = [{ label: 'M', value: 420 }, { label: 'T' }, { label: 'W', value: 500, extra: 20, title: 'Wed 21 Oct' }];
    await render(<DurationBars data={data} need={480} onPressBar={onPressBar} />);
    await layout(300);
    await tap(byLabel('Sleep per night'), 250);
    expect(onPressBar).toHaveBeenCalledWith(2);
    await tap(byLabel('Sleep per night'), 150);
    expect(onPressBar).toHaveBeenCalledTimes(1);
    expect(text()).toContain('No data');
  });

  it('scrubs a bar chart while dragging', async () => {
    const data = [{ label: 'M', value: 420, title: 'Mon 19 Oct' }, { label: 'T', value: 440, title: 'Tue 20 Oct' }, { label: 'W', value: 500, extra: 20, title: 'Wed 21 Oct' }];
    await render(<DurationBars data={data} need={480} />);
    await layout(300);
    const s = byLabel('Sleep per night');
    await act(async () => {
      s.props.onResponderGrant(touch(20, 1));
      jest.advanceTimersByTime(250); // press and hold starts the scrub
    });
    expect(text()).toContain('Mon 19 Oct');
    await act(async () => s.props.onResponderMove(touch(250, 3, 20)));
    expect(text()).toContain('Wed 21 Oct');
    expect(text()).toContain('8h 40m');
    expect(text()).toContain('incl. 20m nap');
  });
});

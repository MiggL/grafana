import {
  ArrayVector,
  DataFrame,
  Field,
  FieldType,
  formattedValueToString,
  getDisplayProcessor,
  getFieldColorModeForField,
  getFieldSeriesColor,
  GrafanaTheme2,
  MutableDataFrame,
  VizOrientation,
} from '@grafana/data';
import {
  BarChartFieldConfig,
  BarChartOptions,
  defaultBarChartFieldConfig,
  ValueRotationConfig,
  ValueRotationMode,
} from './types';
import { BarsOptions, getConfig } from './bars';
import { AxisPlacement, ScaleDirection, ScaleDistribution, ScaleOrientation, StackingMode } from '@grafana/schema';
import { FIXED_UNIT, measureText, UPlotConfigBuilder, UPlotConfigPrepFn, UPLOT_AXIS_FONT_SIZE } from '@grafana/ui';
import { collectStackingGroups } from '../../../../../packages/grafana-ui/src/components/uPlot/utils';
import { Padding } from 'uplot';

/** @alpha */
function getBarCharScaleOrientation(orientation: VizOrientation) {
  if (orientation === VizOrientation.Vertical) {
    return {
      xOri: ScaleOrientation.Horizontal,
      xDir: ScaleDirection.Right,
      yOri: ScaleOrientation.Vertical,
      yDir: ScaleDirection.Up,
    };
  }

  return {
    xOri: ScaleOrientation.Vertical,
    xDir: ScaleDirection.Down,
    yOri: ScaleOrientation.Horizontal,
    yDir: ScaleDirection.Right,
  };
}

export const preparePlotConfigBuilder: UPlotConfigPrepFn<BarChartOptions> = ({
  frame,
  theme,
  orientation,
  showValue,
  groupWidth,
  barWidth,
  stacking,
  text,
  rawValue,
  allFrames,
  valueRotation,
  valueMaxLength,
}) => {
  const builder = new UPlotConfigBuilder();
  const defaultValueFormatter = (seriesIdx: number, value: any) => {
    return shortenValue(formattedValueToString(frame.fields[seriesIdx].display!(value)), valueMaxLength);
  };

  // bar orientation -> x scale orientation & direction
  const vizOrientation = getBarCharScaleOrientation(orientation);

  const formatValue = defaultValueFormatter;

  // Use bar width when only one field
  if (frame.fields.length === 2) {
    groupWidth = barWidth;
    barWidth = 1;
  }

  const opts: BarsOptions = {
    xOri: vizOrientation.xOri,
    xDir: vizOrientation.xDir,
    groupWidth,
    barWidth,
    stacking,
    rawValue,
    formatValue,
    text,
    showValue,
  };

  const config = getConfig(opts, theme);

  builder.setCursor(config.cursor);

  builder.addHook('init', config.init);
  builder.addHook('drawClear', config.drawClear);
  builder.addHook('draw', config.draw);

  builder.setTooltipInterpolator(config.interpolateTooltip);

  const rawRotation = getRotationAngle(valueRotation);
  if (vizOrientation.xOri === ScaleOrientation.Horizontal && rawRotation !== 0) {
    builder.setPadding(getRotationPadding(frame, rawRotation, theme, valueMaxLength));
  }

  builder.setPrepData(config.prepData);

  builder.addScale({
    scaleKey: 'x',
    isTime: false,
    distribution: ScaleDistribution.Ordinal,
    orientation: vizOrientation.xOri,
    direction: vizOrientation.xDir,
  });

  builder.addAxis({
    scaleKey: 'x',
    isTime: false,
    placement: vizOrientation.xOri === 0 ? AxisPlacement.Bottom : AxisPlacement.Left,
    splits: config.xSplits,
    values: config.xValues,
    grid: { show: false },
    ticks: false,
    gap: 15,
    valueRotation: rawRotation,
    theme,
  });

  let seriesIndex = 0;

  const stackingGroups: Map<string, number[]> = new Map();

  // iterate the y values
  for (let i = 1; i < frame.fields.length; i++) {
    const field = frame.fields[i];

    field.state!.seriesIndex = seriesIndex++;

    const customConfig: BarChartFieldConfig = { ...defaultBarChartFieldConfig, ...field.config.custom };

    const scaleKey = field.config.unit || FIXED_UNIT;
    const colorMode = getFieldColorModeForField(field);
    const scaleColor = getFieldSeriesColor(field, theme);
    const seriesColor = scaleColor.color;

    builder.addSeries({
      scaleKey,
      pxAlign: true,
      lineWidth: customConfig.lineWidth,
      lineColor: seriesColor,
      fillOpacity: customConfig.fillOpacity,
      theme,
      colorMode,
      pathBuilder: config.barsBuilder,
      show: !customConfig.hideFrom?.viz,
      gradientMode: customConfig.gradientMode,
      thresholds: field.config.thresholds,
      hardMin: field.config.min,
      hardMax: field.config.max,
      softMin: customConfig.axisSoftMin,
      softMax: customConfig.axisSoftMax,

      // The following properties are not used in the uPlot config, but are utilized as transport for legend config
      // PlotLegend currently gets unfiltered DataFrame[], so index must be into that field array, not the prepped frame's which we're iterating here
      dataFrameFieldIndex: {
        fieldIndex: allFrames[0].fields.findIndex(
          (f) => f.type === FieldType.number && f.state?.seriesIndex === seriesIndex - 1
        ),
        frameIndex: 0,
      },
    });

    // The builder will manage unique scaleKeys and combine where appropriate
    builder.addScale({
      scaleKey,
      min: field.config.min,
      max: field.config.max,
      softMin: customConfig.axisSoftMin,
      softMax: customConfig.axisSoftMax,
      orientation: vizOrientation.yOri,
      direction: vizOrientation.yDir,
    });

    if (customConfig.axisPlacement !== AxisPlacement.Hidden) {
      let placement = customConfig.axisPlacement;
      if (!placement || placement === AxisPlacement.Auto) {
        placement = AxisPlacement.Left;
      }
      if (vizOrientation.xOri === 1) {
        if (placement === AxisPlacement.Left) {
          placement = AxisPlacement.Bottom;
        }
        if (placement === AxisPlacement.Right) {
          placement = AxisPlacement.Top;
        }
      }

      builder.addAxis({
        scaleKey,
        label: customConfig.axisLabel,
        size: customConfig.axisWidth,
        placement,
        formatValue: (v) => formattedValueToString(field.display!(v)),
        theme,
        grid: { show: customConfig.axisGridShow },
      });
    }

    collectStackingGroups(field, stackingGroups, seriesIndex);
  }

  if (stackingGroups.size !== 0) {
    builder.setStacking(true);
    for (const [_, seriesIdxs] of stackingGroups.entries()) {
      for (let j = seriesIdxs.length - 1; j > 0; j--) {
        builder.addBand({
          series: [seriesIdxs[j], seriesIdxs[j - 1]],
        });
      }
    }
  }

  return builder;
};

function shortenValue(value: string, length: number) {
  if (value.length > length) {
    return value.substring(0, length).concat('...');
  } else {
    return value;
  }
}

export function getRotationAngle(config: ValueRotationConfig): number {
  switch (config.mode) {
    case ValueRotationMode.None: {
      return 0;
    }
    case ValueRotationMode.Custom: {
      return config.customRotation || 0;
    }
    case ValueRotationMode.Slope: {
      return -45;
    }
    case ValueRotationMode.Vertical: {
      return -90;
    }
  }
}

function getRotationPadding(
  frame: DataFrame,
  rotateLabel: number,
  theme: GrafanaTheme2,
  valueMaxLength: number
): Padding {
  const values = frame.fields[0].values;
  const fontSize = UPLOT_AXIS_FONT_SIZE;
  const displayProcessor = frame.fields[0].display ?? ((v) => v);
  let maxLength = 0;
  for (let i = 0; i < values.length; i++) {
    let size = measureText(
      shortenValue(formattedValueToString(displayProcessor(values.get(i))), valueMaxLength),
      fontSize
    );
    maxLength = size.width > maxLength ? size.width : maxLength;
  }

  // Add padding to the right if the labels are rotated in a way that makes the last label extend outside the graph.
  const paddingRight =
    rotateLabel < 0
      ? Math.cos((rotateLabel * -1 * Math.PI) / 180) *
        measureText(
          shortenValue(formattedValueToString(displayProcessor(values.get(values.length - 1))), valueMaxLength),
          fontSize
        ).width
      : 0;

  // Add padding to the left if the labels are rotated in a way that makes the first label extend outside the graph.
  const paddingLeft =
    rotateLabel > 0
      ? Math.cos((rotateLabel * Math.PI) / 180) *
        measureText(shortenValue(formattedValueToString(displayProcessor(values.get(0))), valueMaxLength), fontSize)
          .width
      : 0;

  // Add padding to the bottom to avoid clipping the rotated labels.
  const paddingBottom = Math.sin(((rotateLabel >= 0 ? rotateLabel : rotateLabel * -1) * Math.PI) / 180) * maxLength;

  return [0, paddingRight, paddingBottom, paddingLeft];
}

/** @internal */
export function preparePlotFrame(data: DataFrame[]) {
  const firstFrame = data[0];
  const firstString = firstFrame.fields.find((f) => f.type === FieldType.string);

  if (!firstString) {
    throw new Error('No string field in DF');
  }

  const resultFrame = new MutableDataFrame();
  resultFrame.addField(firstString);

  for (const f of firstFrame.fields) {
    if (f.type === FieldType.number) {
      resultFrame.addField(f);
    }
  }

  return resultFrame;
}

/** @internal */
export function prepareGraphableFrames(
  series: DataFrame[],
  theme: GrafanaTheme2,
  stacking: StackingMode
): { frames?: DataFrame[]; warn?: string } {
  if (!series?.length) {
    return { warn: 'No data in response' };
  }

  const frames: DataFrame[] = [];
  const firstFrame = series[0];

  if (!firstFrame.fields.some((f) => f.type === FieldType.string)) {
    return {
      warn: 'Bar charts requires a string field',
    };
  }

  if (!firstFrame.fields.some((f) => f.type === FieldType.number)) {
    return {
      warn: 'No numeric fields found',
    };
  }

  let seriesIndex = 0;

  for (let frame of series) {
    const fields: Field[] = [];
    for (const field of frame.fields) {
      if (field.type === FieldType.number) {
        field.state = field.state ?? {};

        field.state.seriesIndex = seriesIndex++;

        let copy = {
          ...field,
          config: {
            ...field.config,
            custom: {
              ...field.config.custom,
              stacking: {
                group: '_',
                mode: stacking,
              },
            },
          },
          values: new ArrayVector(
            field.values.toArray().map((v) => {
              if (!(Number.isFinite(v) || v == null)) {
                return null;
              }
              return v;
            })
          ),
        };

        if (stacking === StackingMode.Percent) {
          copy.config.unit = 'percentunit';
          copy.display = getDisplayProcessor({ field: copy, theme });
        }

        fields.push(copy);
      } else {
        fields.push({ ...field });
      }
    }

    frames.push({
      ...frame,
      fields,
    });
  }

  return { frames };
}

numberFormatter = Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 0,
});

enumerateGroupedItems = (array, key) => {
    const group = {};

    return array.map((item) => {
        const value = item[key];

        group[value] = group[value] ?? 0;
        group[value]++;

        let newValue = value;

        if (group[value] > 1) {
            newValue = `${newValue} (${group[value]})`;
        }

        return { ...item, [key]: newValue, [`original_${key}`]: value };
    })
};

addScrollbarToChart = function (H) {
    //internal functions
    function stopEvent(e) {
        if (e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            if (e.stopPropagation) {
                e.stopPropagation();
            }
            e.cancelBubble = true;
        }
    }

    //the wrap
    H.wrap(H.Chart.prototype, 'render', function (proceed) {
        const chart = this;

        proceed.call(chart);

        // Add the mousewheel event
        H.addEvent(chart.container, document.onmousewheel === undefined ? 'DOMMouseScroll' : 'mousewheel', function (event) {
            let delta, extr, step, newMin, newMax, axis = chart.xAxis[0];

            e = chart.pointer.normalize(event);
            // Firefox uses e.detail, WebKit and IE uses wheelDelta
            delta = e.detail || -(e.wheelDelta / 120);
            delta = delta < 0 ? -1 : 1;

            if (chart.isInsidePlot(e.chartX - chart.plotLeft, e.chartY - chart.plotTop)) {
                extr = axis.getExtremes();
                step = (extr.max - extr.min) / 10 * delta;
                newMin = extr.min + step;
                newMax = extr.max + step;

                if (newMin > axis.dataMin - 1 && newMax < axis.dataMax + 1) {
                    axis.setExtremes(newMin, newMax, true, false);
                }
            }

            stopEvent(event);
            return false;
        });
    });
}

formatDate = function (date) {
    return date.toISOString().substring(0, 10);
}

decimalHash = string => {
    let sum = 0;
    for (let i = 0; i < string.length; i++)
        sum += (i + 1) * string.codePointAt(i) / (1 << 8)
    return sum % 1;
}

getColorFromList = function (colorList, key) {
    const index = Math.floor(decimalHash(key) * colorList.length);
    return colorList[index];
}

class TimelineChart {
    sections;
    tooltip;

    render({ data, element, minDate, maxDate }) {
        const width = element.clientWidth - 10,
            height = element.clientHeight - 50;

        const currentDate = new Date();
        const chartHeight = height - 100;
        const minItemHeight = 30;
        const itemsInView = chartHeight > minItemHeight * data.length ? data.length : Math.floor(chartHeight / minItemHeight);

        Highcharts.chart('timeline-chart', {
            chart: {
                width,
                height,
                type: 'columnrange',
                scrollablePlotArea: {
                    minWidth: width,
                    scrollPositionX: 0
                },
                inverted: true
            },
            title: {
                text: ''
            },
            xAxis: {
                type: 'category',
                categories: data,
                max: itemsInView,
                scrollbar: {
                    enabled: true
                },
                labels: {
                    formatter: function () {
                        const label = this.value.original_name
                        return typeof label === 'string' ? label : null;
                    }
                },
            },
            yAxis: {
                opposite: true,
                min: minDate,
                max: maxDate,
                title: {
                    text: ''
                },
                labels: {
                    rotation: -45,
                    format: "{value:%Y-%m-%d}"
                },
                type: "datetime",
                plotLines: [{
                    value: currentDate,
                    color: 'rgb(102 102 102 / 60%)',
                    dashStyle: 'shortdash',
                    zIndex: 10,
                    width: 1,
                    label: {
                        text: currentDate.toLocaleDateString("en-US", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
                        style: {
                            fontSize: 11,
                            color: 'rgb(102 102 102 / 60%)',
                            fontStyle: 'italic',
                        }
                    }
                }],
            },
            tooltip: {
                useHTML: true,
                formatter: function () {
                    const { name, low, high, value } = this.point;

                    return `<div>
                        ${name}: <b>${formatDate(new Date(low))} - ${formatDate(new Date(high))} (${numberFormatter.format(value)})</b>
                    </div>`;
                }
            },
            plotOptions: {
                series: {
                    pointWidth: Math.max(chartHeight / (itemsInView * 2), 15),
                    cursor: 'pointer',
                },
                columnrange: {
                    borderRadius: 4,
                    minPointLength: 5,
                    dataLabels: {
                        enabled: false,
                        format: '{y:%Y-%m-%d}'
                    }
                }
            },
            series: [{
                name: 'ranges',
                data
            }],
            legend: {
                enabled: false
            },
            credits: {
                enabled: false
            }
        });

    }
}

const vis = {
    id: 'treemap',
    label: 'Treemap',
    options: {
        color_range: {
            type: 'array',
            label: 'Color Range',
            display: 'colors',
            default: [
                "#62bad4",
                "#a9c574",
                "#929292",
                "#9fdee0",
                "#1f3e5a",
                "#90c8ae",
                "#92818d",
                "#c5c6a6",
                "#82c2ca",
                "#cee0a0",
                "#928fb4",
                "#9fc190"
            ],
        }
    },
    // set up the initial state of the visualization
    create(element) {
        const container = element.appendChild(document.createElement("div"));
        container.setAttribute("id", "timeline-chart");

        const css = document.createElement("style");
        css.setAttribute("type", "text/css")
        css.innerHTML = `
            .highcharts-axis-labels text {
                font-family: inherit;
            }

            .highcharts-plot-line-label, [class^="highcharts-plot-lines"] {
                pointer-events: none;
            }
        `;

        element.prepend(css);

        // add chart
        this.timelineChart = new TimelineChart();
        addScrollbarToChart(Highcharts);
    },
    // render in response to the data or settings changing
    updateAsync(data, element, config, queryResponse, details, done) {
        const { fields } = queryResponse;
        const { color_range = [] } = config;


        const dimension = fields.dimension_like[0];
        const measure = fields.measure_like[0];

        let dimensionStartDate, dimensionEndDate;

        // hack for unique query
        if (fields.dimension_like.length === 3) {
            dimensionStartDate = fields.dimension_like[1];
            dimensionEndDate = fields.dimension_like[2];
        } else if (fields.measure_like.length === 3) {
            dimensionStartDate = fields.measure_like[1];
            dimensionEndDate = fields.measure_like[2];
        }

        const dimension_key = dimension.name;
        const dimensionStartDate_key = dimensionStartDate.name;
        const dimensionEndDate_key = dimensionEndDate.name;
        const measure_key = measure.name;

        const isReady = color_range.length > 0;

        console.log('[updateAsync]: ', { dimension_key, dimensionStartDate_key, dimensionEndDate_key, measure_key });

        const minDate = Math.min(...data.map(item => new Date(item[dimensionStartDate_key].value)));
        const maxDate = Math.max(...data.map(item => new Date(item[dimensionEndDate_key].value)));

        const transformedData = isReady ? data.map((item, i) => {
            const name = String(item[dimension_key].value);
            const startDate = item[dimensionStartDate_key].value;
            const endDate = item[dimensionEndDate_key].value;
            const value = item[measure_key].value;

            return {
                name,
                low: new Date(startDate).getTime(),
                high: new Date(endDate).getTime(),
                color: getColorFromList(color_range, i + name),
                value,
            }
        }) : [];

        const groupedData = enumerateGroupedItems(transformedData, 'name');

        // render chart
        this.timelineChart.render({ data: groupedData, element, minDate, maxDate });

        done();
    },
};

looker.plugins.visualizations.add(vis);
(function () {
    "use strict";

    const { createElement: h, useEffect, useMemo, useRef, useState } = React;
    const COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"];
    const AXIS_COLORS = ["#303030", "#d95f02", "#1b9e77"];
    const SCALES = { Original: null, Milliseconds: 0.001, Seconds: 1, Minutes: 60, Hours: 3600, Days: 86400 };
    const DT_REFS = ["First value", "Start of day", "Start of month"];
    const AXIS_OPTION_LABELS = ["Y1", "Y2", "Y3"];
    function createEmptyYLimits() {
        return [{ min: "", max: "" }, { min: "", max: "" }, { min: "", max: "" }];
    }

    function createEmptyYAxisMeta() {
        return [{ label: "", unit: "" }, { label: "", unit: "" }, { label: "", unit: "" }];
    }

    function createId(prefix, suffix) {
        return `${prefix}-${Date.now()}-${suffix}`;
    }

    function createSeriesItem(column, index) {
        return {
            id: createId(column || "series", index),
            column,
            axis: 0,
            label: column,
            color: COLORS[index % COLORS.length],
        };
    }

    function createAnnotationItem(index) {
        return { id: createId("annotation", index), text: "New note", x: 0.08, y: 0.92 };
    }

    function createGuideLineItem(index) {
        return { id: createId("line", index), axis: 0, x0: "", x1: "", y0: "", y1: "", color: "#6b7280", width: "2", dash: "dash" };
    }

    function toNumber(value) {
        if (value === null || value === undefined || String(value).trim() === "") {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function isDuration(value) {
        return typeof value === "string" && /^-?(?:(\d+)\.)?\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value.trim());
    }

    function durationToSeconds(value) {
        if (!isDuration(value)) {
            return null;
        }
        const text = value.trim();
        const sign = text.startsWith("-") ? -1 : 1;
        const clean = sign === -1 ? text.slice(1) : text;
        const parts = clean.includes(".") ? clean.split(".", 2) : [null, clean];
        const days = parts[1] ? Number(parts[0]) : 0;
        const timePart = parts[1] || parts[0];
        const pieces = timePart.split(":").map(Number);
        if (pieces.some(Number.isNaN)) {
            return null;
        }
        const [hours, minutes, seconds] = pieces.length === 2 ? [pieces[0], pieces[1], 0] : pieces;
        return sign * ((((days * 24) + hours) * 60 + minutes) * 60 + seconds);
    }

    function rangeText(values) {
        const clean = values.filter((value) => Number.isFinite(value));
        if (!clean.length) {
            return "-";
        }
        const format = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
        return `${format(Math.min(...clean))} to ${format(Math.max(...clean))}`;
    }

    function inferType(values) {
        const sample = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").slice(0, 40);
        if (!sample.length) {
            return "empty";
        }
        const numericHits = sample.filter((value) => Number.isFinite(Number(value))).length;
        if (numericHits >= Math.max(3, Math.floor(sample.length * 0.7))) {
            return "numeric";
        }
        const dateHits = sample.filter((value) => !Number.isNaN(Date.parse(value))).length;
        if (dateHits >= Math.max(3, Math.floor(sample.length * 0.7))) {
            return "datetime";
        }
        const durationHits = sample.filter(isDuration).length;
        return durationHits >= Math.max(3, Math.floor(sample.length * 0.7)) ? "duration" : "text";
    }

    function buildAxisRange(minText, maxText) {
        const minValue = minText === "" ? null : Number(minText);
        const maxValue = maxText === "" ? null : Number(maxText);

        const hasMin = Number.isFinite(minValue);
        const hasMax = Number.isFinite(maxValue);

        if (!hasMin && !hasMax) {
            return null;
        }

        if (hasMin && hasMax) {
            return minValue < maxValue ? [minValue, maxValue] : null;
        }

        return [hasMin ? minValue : null, hasMax ? maxValue : null];
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function formatAxisTitle(axisConfig, fallback) {
        const baseLabel = axisConfig.label.trim();
        const unit = axisConfig.unit.trim();
        if (!baseLabel) {
            return "";
        }
        return unit ? `${baseLabel} (${unit})` : baseLabel;
    }

    function axisTagStyle(axisIndex) {
        const color = AXIS_COLORS[axisIndex] || AXIS_COLORS[0];
        return {
            background: `${color}18`,
            color,
            border: `1px solid ${color}33`,
        };
    }

    function formatAxisLegendLabel(axisIndex, axisConfig) {
        const titledAxis = formatAxisTitle(axisConfig, "").trim();
        return titledAxis || AXIS_OPTION_LABELS[axisIndex] || `Y${axisIndex + 1}`;
    }

    function isGuideLineComplete(item) {
        return String(item.x0).trim() !== "" &&
            String(item.x1).trim() !== "" &&
            String(item.y0).trim() !== "" &&
            String(item.y1).trim() !== "" &&
            Number.isFinite(Number(item.y0)) &&
            Number.isFinite(Number(item.y1));
    }

    function parseWorkbook(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    if (file.name.toLowerCase().endsWith(".csv")) {
                        const parsed = Papa.parse(event.target.result, { header: true, skipEmptyLines: true });
                        resolve({ sheetNames: ["CSV Data"], sheets: { "CSV Data": parsed.data } });
                        return;
                    }
                    const workbook = XLSX.read(event.target.result, { type: "binary" });
                    const sheets = {};
                    workbook.SheetNames.forEach((name) => {
                        sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
                    });
                    resolve({ sheetNames: workbook.SheetNames, sheets });
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(reader.error);
            if (file.name.toLowerCase().endsWith(".csv")) {
                reader.readAsText(file);
            } else {
                reader.readAsBinaryString(file);
            }
        });
    }

    function convertX(rows, xColumn, mode, datetimeReference) {
        const raw = rows.map((row) => row[xColumn]);
        const numeric = raw.map(toNumber);
        if (!xColumn || mode === "Original") {
            const numericHits = numeric.filter((value) => value !== null).length;
            const plotX = numericHits > 0 ? numeric : raw;
            return { plotX, numericX: numeric, label: xColumn };
        }
        const scale = SCALES[mode];
        const durations = raw.map(durationToSeconds);
        if (durations.some((value) => value !== null)) {
            const converted = durations.map((value) => (value === null ? null : value / scale));
            return { plotX: converted, numericX: converted, label: `${xColumn} (${mode.toLowerCase()})` };
        }
        const dates = raw.map((value) => {
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        });
        const first = dates.find(Boolean);
        if (!first) {
            return { plotX: raw, numericX: numeric, label: xColumn };
        }
        const baseline =
            datetimeReference === "Start of day"
                ? new Date(first.getFullYear(), first.getMonth(), first.getDate())
                : datetimeReference === "Start of month"
                  ? new Date(first.getFullYear(), first.getMonth(), 1)
                  : first;
        const converted = dates.map((date) => (date ? (date.getTime() - baseline.getTime()) / 1000 / scale : null));
        return { plotX: converted, numericX: converted, label: `${xColumn} (${mode.toLowerCase()})` };
    }

    function App() {
        const plotRef = useRef(null);
        const [fileName, setFileName] = useState("");
        const [book, setBook] = useState(null);
        const [sheet, setSheet] = useState("");
        const [rows, setRows] = useState([]);
        const [columns, setColumns] = useState([]);
        const [types, setTypes] = useState({});
        const [xColumn, setXColumn] = useState("");
        const [xMin, setXMin] = useState("");
        const [xMax, setXMax] = useState("");
        const [xMode, setXMode] = useState("Original");
        const [dtRef, setDtRef] = useState("First value");
        const [axisCount, setAxisCount] = useState(1);
        const [yAxisMeta, setYAxisMeta] = useState(createEmptyYAxisMeta);
        const [yLimits, setYLimits] = useState(createEmptyYLimits);
        const [series, setSeries] = useState([]);
        const [title, setTitle] = useState("");
        const [xLabel, setXLabel] = useState("");
        const [showLegend, setShowLegend] = useState(true);
        const [showGrid, setShowGrid] = useState(true);
        const [showAdvanced, setShowAdvanced] = useState(false);
        const [annotations, setAnnotations] = useState([]);
        const [guideLines, setGuideLines] = useState([]);
        const [status, setStatus] = useState("");

        const summary = useMemo(() => {
            if (!rows.length || !columns.length) {
                return "Load a CSV or Excel file to inspect rows, columns, and numeric columns.";
            }
            const numericCols = columns.filter((column) => types[column] === "numeric");
            return `Rows: ${rows.length}\nColumns: ${columns.length}\nNumeric columns: ${numericCols.length ? numericCols.join(", ") : "None detected"}`;
        }, [rows, columns, types]);
        const numericColumns = useMemo(() => columns.filter((column) => types[column] === "numeric"), [columns, types]);
        const activeAnnotations = useMemo(() => annotations.filter((item) => item.text.trim()).length, [annotations]);
        const completeGuideLines = useMemo(() => guideLines.filter(isGuideLineComplete).length, [guideLines]);
        const canPlot = rows.length > 0 && series.length > 0 && Boolean(xColumn);
        const sourceMeta = fileName ? `Source: ${fileName}` : "Source: none";
        const sheetMeta = sheet ? `Sheet: ${sheet}` : "Sheet: -";
        const plotStats = useMemo(() => [
            { label: "Rows", value: rows.length || "-" },
            { label: "Series", value: series.length || "-" },
            { label: "Notes", value: activeAnnotations || "-" },
            { label: "Lines", value: completeGuideLines || "-" },
        ], [rows.length, series.length, activeAnnotations, completeGuideLines]);

        const preparedX = useMemo(() => convertX(rows, xColumn, xMode, dtRef), [rows, xColumn, xMode, dtRef]);
        const xRange = useMemo(() => rangeText(preparedX.numericX || []), [preparedX]);
        const xAxisRange = useMemo(() => buildAxisRange(xMin, xMax), [xMin, xMax]);
        const yAxisRanges = useMemo(() => yLimits.map((limit) => buildAxisRange(limit.min, limit.max)), [yLimits]);
        const yRanges = useMemo(() => [0, 1, 2].map((axisIndex) => {
            const values = series
                .filter((item) => item.axis === axisIndex)
                .flatMap((item) => rows.map((row) => toNumber(row[item.column])))
                .filter((value) => value !== null);
            return rangeText(values);
        }), [series, rows]);

        useEffect(() => {
            if (!plotRef.current) {
                return;
            }
            if (!canPlot) {
                Plotly.react(plotRef.current, [], {
                    paper_bgcolor: "rgba(0,0,0,0)",
                    plot_bgcolor: "rgba(255,255,255,0.72)",
                    xaxis: { visible: false },
                    yaxis: { visible: false },
                    annotations: [{ text: "Upload a file and choose series to start plotting.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false, font: { size: 18, color: "#66717d" } }],
                    margin: { l: 40, r: 40, t: 60, b: 40 },
                }, { responsive: true, displaylogo: false });
                return;
            }

            const traces = series.map((item) => ({
                type: "scatter",
                mode: "lines",
                x: preparedX.plotX,
                y: rows.map((row) => toNumber(row[item.column])),
                name: axisCount > 1
                    ? `${item.label || item.column} [${formatAxisLegendLabel(item.axis, yAxisMeta[item.axis] || { label: "", unit: "" })}]`
                    : (item.label || item.column),
                line: { color: item.color, width: 2.2 },
                yaxis: item.axis === 0 ? "y" : `y${item.axis + 1}`,
            }));

            const plotAnnotations = annotations
                .filter((item) => item.text.trim())
                .map((item) => ({
                    xref: "paper",
                    yref: "paper",
                    x: clamp(item.x, 0, 1),
                    y: clamp(item.y, 0, 1),
                    text: item.text,
                    showarrow: false,
                    align: "left",
                    bgcolor: "rgba(255,255,255,0.88)",
                    bordercolor: "rgba(24,33,39,0.18)",
                    borderwidth: 1,
                    borderpad: 6,
                    font: { size: 14, color: "#1f2933" },
                }));

            const plotShapes = guideLines
                .filter(isGuideLineComplete)
                .map((item) => ({
                    type: "line",
                    xref: "x",
                    yref: item.axis === 0 ? "y" : `y${item.axis + 1}`,
                    x0: item.x0,
                    x1: item.x1,
                    y0: Number(item.y0),
                    y1: Number(item.y1),
                    line: {
                        color: item.color,
                        width: Number(item.width) || 2,
                        dash: item.dash || "solid",
                    },
                }));

            const layout = {
                title: title || undefined,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "#ffffff",
                margin: { l: 60, r: axisCount > 1 ? 100 + (axisCount - 2) * 50 : 40, t: 64, b: 56 },
                showlegend: showLegend,
                annotations: plotAnnotations,
                shapes: plotShapes,
                legend: { orientation: "h", y: 1.12, x: 0 },
                xaxis: {
                    title: xLabel || preparedX.label,
                    gridcolor: showGrid ? "rgba(24,33,39,0.08)" : "rgba(0,0,0,0)",
                    zeroline: false,
                    ...(xAxisRange ? { range: xAxisRange } : {}),
                },
                yaxis: {
                    title: formatAxisTitle(yAxisMeta[0], "Y1"),
                    color: AXIS_COLORS[0],
                    gridcolor: showGrid ? "rgba(24,33,39,0.08)" : "rgba(0,0,0,0)",
                    showline: true,
                    linewidth: 2,
                    linecolor: AXIS_COLORS[0],
                    zeroline: false,
                    ...(yAxisRanges[0] ? { range: yAxisRanges[0] } : {}),
                },
            };

            if (axisCount >= 2) {
                layout.yaxis2 = {
                    title: formatAxisTitle(yAxisMeta[1], "Y2"),
                    titlefont: { color: AXIS_COLORS[1] },
                    tickfont: { color: AXIS_COLORS[1] },
                    overlaying: "y",
                    side: "right",
                    showline: true,
                    linewidth: 2,
                    linecolor: AXIS_COLORS[1],
                    zeroline: false,
                    ...(yAxisRanges[1] ? { range: yAxisRanges[1] } : {}),
                };
            }

            if (axisCount >= 3) {
                layout.yaxis3 = {
                    title: formatAxisTitle(yAxisMeta[2], "Y3"),
                    titlefont: { color: AXIS_COLORS[2] },
                    tickfont: { color: AXIS_COLORS[2] },
                    overlaying: "y",
                    side: "right",
                    anchor: "free",
                    position: 1,
                    autoshift: true,
                    showline: true,
                    linewidth: 2,
                    linecolor: AXIS_COLORS[2],
                    zeroline: false,
                    ...(yAxisRanges[2] ? { range: yAxisRanges[2] } : {}),
                };
            }

            Plotly.react(plotRef.current, traces, layout, {
                responsive: true,
                displaylogo: false,
                editable: true,
                edits: {
                    annotationPosition: true,
                    annotationText: true,
                },
            });
        }, [rows, series, xColumn, preparedX, axisCount, xMin, xMax, yAxisMeta, yLimits, title, xLabel, showLegend, showGrid, annotations, guideLines, canPlot]);

        useEffect(() => {
            if (!plotRef.current) {
                return undefined;
            }

            const graph = plotRef.current;
            const handleRelayout = (eventData) => {
                const changes = {};
                Object.entries(eventData || {}).forEach(([key, value]) => {
                    const match = key.match(/^annotations\[(\d+)\]\.(text|x|y)$/);
                    if (!match) {
                        return;
                    }
                    const index = Number(match[1]);
                    const field = match[2];
                    changes[index] = changes[index] || {};
                    changes[index][field] = field === "text" ? String(value) : clamp(Number(value), 0, 1);
                });

                if (!Object.keys(changes).length) {
                    return;
                }

                setAnnotations((current) => current.map((item, index) => changes[index] ? { ...item, ...changes[index] } : item));
            };

            graph.on("plotly_relayout", handleRelayout);
            return () => {
                graph.removeListener("plotly_relayout", handleRelayout);
            };
        }, []);

        function applySheet(name, nextRows) {
            const nextColumns = nextRows.length ? Object.keys(nextRows[0]) : [];
            const nextTypes = {};
            nextColumns.forEach((column) => {
                nextTypes[column] = inferType(nextRows.map((row) => row[column]));
            });
            setSheet(name);
            setRows(nextRows);
            setColumns(nextColumns);
            setTypes(nextTypes);
            setXColumn(nextColumns[0] || "");
            const nextNumericColumns = nextColumns.filter((column) => nextTypes[column] === "numeric");
            setSeries(nextNumericColumns.slice(0, 4).map(createSeriesItem));
            setYLimits(createEmptyYLimits());
            setYAxisMeta(createEmptyYAxisMeta());
            setGuideLines([]);
            setAnnotations([]);
            setAxisCount(1);
            setTitle("");
            setXLabel("");
            setXMin("");
            setXMax("");
            setShowAdvanced(false);
            setStatus("");
        }

        async function onFileChange(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                return;
            }
            try {
                setStatus("Reading file...");
                setFileName(file.name);
                const nextBook = await parseWorkbook(file);
                setBook(nextBook);
                const firstSheet = nextBook.sheetNames[0] || "";
                applySheet(firstSheet, nextBook.sheets[firstSheet] || []);
            } catch (error) {
                console.error(error);
                setStatus(`Could not read file: ${error.message}`);
            }
        }

        function updateSeries(id, patch) {
            setSeries((current) => current.map((item) => item.id === id ? { ...item, ...patch, label: patch.column && patch.label === undefined ? patch.column : (patch.label ?? item.label) } : item));
        }

        function updateYLimit(index, key, value) {
            setYLimits((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
        }

        function updateYAxisMeta(index, key, value) {
            setYAxisMeta((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
        }

        function updateAnnotation(id, patch) {
            setAnnotations((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
        }

        function updateGuideLine(id, patch) {
            setGuideLines((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
        }

        function clearPlotSettings() {
            setAxisCount(1);
            setYAxisMeta(createEmptyYAxisMeta());
            setYLimits(createEmptyYLimits());
            setTitle("");
            setXLabel("");
            setXMin("");
            setXMax("");
            setShowLegend(true);
            setShowGrid(true);
            setAnnotations([]);
            setGuideLines([]);
            setShowAdvanced(false);
            setSeries(numericColumns.slice(0, 4).map(createSeriesItem));
        }

        async function downloadPng() {
            if (!plotRef.current) {
                return;
            }
            const graph = plotRef.current;
            const originalPaperBackground = graph.layout && graph.layout.paper_bgcolor ? graph.layout.paper_bgcolor : "rgba(0,0,0,0)";
            const originalPlotBackground = graph.layout && graph.layout.plot_bgcolor ? graph.layout.plot_bgcolor : "#ffffff";

            try {
                await Plotly.relayout(graph, {
                    paper_bgcolor: "#ffffff",
                    plot_bgcolor: "#ffffff",
                });
                await Plotly.downloadImage(graph, {
                    format: "png",
                    filename: "timeseries-plotter",
                    width: 1400,
                    height: 820,
                });
            } finally {
                await Plotly.relayout(graph, {
                    paper_bgcolor: originalPaperBackground,
                    plot_bgcolor: originalPlotBackground,
                });
            }
        }

        const axisButtons = [1, 2, 3].map((count) => h("button", {
            key: count,
            className: count === axisCount ? "button" : "ghost-button",
            type: "button",
            onClick: () => {
                setAxisCount(count);
                setSeries((current) => current.map((item) => ({ ...item, axis: item.axis < count ? item.axis : 0 })));
            },
        }, `${count} Y-Axis${count > 1 ? "es" : ""}`));

        const annotationCards = annotations.map((item, index) => h("div", { className: "series-row", key: item.id },
            h("div", { className: "series-heading" },
                h("strong", null, `Note ${index + 1}`),
                h("span", { className: "series-tag" }, `${Math.round(item.x * 100)}% / ${Math.round(item.y * 100)}%`)
            ),
            h("div", { className: "field" },
                h("label", null, "Text"),
                h("textarea", {
                    value: item.text,
                    rows: 3,
                    onChange: (event) => updateAnnotation(item.id, { text: event.target.value }),
                    placeholder: "Write a note shown inside the graph",
                })
            ),
            h("div", { className: "series-grid" },
                h("div", { className: "field" },
                    h("label", null, "X position (%)"),
                    h("input", {
                        type: "number",
                        min: "0",
                        max: "100",
                        value: Math.round(item.x * 100),
                        onChange: (event) => updateAnnotation(item.id, { x: clamp(Number(event.target.value || 0) / 100, 0, 1) }),
                    })
                ),
                h("div", { className: "field" },
                    h("label", null, "Y position (%)"),
                    h("input", {
                        type: "number",
                        min: "0",
                        max: "100",
                        value: Math.round(item.y * 100),
                        onChange: (event) => updateAnnotation(item.id, { y: clamp(Number(event.target.value || 0) / 100, 0, 1) }),
                    })
                )
            ),
            h("div", { className: "series-actions" },
                h("div", { className: "field" }, h("label", null, "Move"), h("div", { className: "section-note" }, "Drag it on the graph")),
                h("button", { className: "danger-button full-width", type: "button", onClick: () => setAnnotations((current) => current.filter((entry) => entry.id !== item.id)) }, "Remove note")
            )
        ));

        const guideLineCards = guideLines.map((item, index) => h("div", { className: "series-row", key: item.id },
            h("div", { className: "series-heading" },
                h("strong", null, `Line ${index + 1}`),
                h("span", { className: "series-tag", style: axisTagStyle(item.axis) }, AXIS_OPTION_LABELS[item.axis] || "Y1")
            ),
            h("div", { className: "series-grid" },
                h("div", { className: "field" },
                    h("label", null, "Axis"),
                    h("select", { value: String(item.axis), onChange: (event) => updateGuideLine(item.id, { axis: Number(event.target.value) }) }, [0, 1, 2].slice(0, axisCount).map((axisIndex) => h("option", { key: axisIndex, value: String(axisIndex) }, AXIS_OPTION_LABELS[axisIndex])))
                ),
                h("div", { className: "field" },
                    h("label", null, "Dash"),
                    h("select", { value: item.dash, onChange: (event) => updateGuideLine(item.id, { dash: event.target.value }) }, ["solid", "dot", "dash", "longdash"].map((dash) => h("option", { key: dash, value: dash }, dash)))
                )
            ),
            h("div", { className: "series-grid" },
                h("div", { className: "field" },
                    h("label", null, "X start"),
                    h("input", { value: item.x0, onChange: (event) => updateGuideLine(item.id, { x0: event.target.value }), placeholder: "Start X value" })
                ),
                h("div", { className: "field" },
                    h("label", null, "X end"),
                    h("input", { value: item.x1, onChange: (event) => updateGuideLine(item.id, { x1: event.target.value }), placeholder: "End X value" })
                )
            ),
            h("div", { className: "series-grid" },
                h("div", { className: "field" },
                    h("label", null, "Y start"),
                    h("input", { value: item.y0, onChange: (event) => updateGuideLine(item.id, { y0: event.target.value }), placeholder: "Start Y value" })
                ),
                h("div", { className: "field" },
                    h("label", null, "Y end"),
                    h("input", { value: item.y1, onChange: (event) => updateGuideLine(item.id, { y1: event.target.value }), placeholder: "End Y value" })
                )
            ),
            h("div", { className: "series-actions" },
                h("div", { className: "field" },
                    h("label", null, "Style"),
                    h("div", { className: "line-style-row" },
                        h("input", { type: "color", value: item.color, onChange: (event) => updateGuideLine(item.id, { color: event.target.value }) }),
                        h("input", { type: "number", min: "1", max: "10", value: String(item.width), onChange: (event) => updateGuideLine(item.id, { width: event.target.value }) })
                    )
                ),
                h("button", { className: "danger-button full-width", type: "button", onClick: () => setGuideLines((current) => current.filter((entry) => entry.id !== item.id)) }, "Remove line")
            )
        ));

        const seriesCards = series.map((item, index) => h("div", { className: "series-row", key: item.id },
            h("div", { className: "series-heading" },
                h("strong", null, `Series ${index + 1}`),
                h("span", { className: "series-tag", style: axisTagStyle(item.axis) }, AXIS_OPTION_LABELS[item.axis] || "Y1")
            ),
            h("div", { className: "series-grid" },
                h("div", { className: "field" }, h("label", null, "Column"), h("select", { value: item.column, onChange: (event) => updateSeries(item.id, { column: event.target.value }) }, columns.map((column) => h("option", { key: column, value: column }, column)))),
                h("div", { className: "field" }, h("label", null, "Axis"), h("select", { value: String(item.axis), onChange: (event) => updateSeries(item.id, { axis: Number(event.target.value) }) }, [0, 1, 2].slice(0, axisCount).map((axisIndex) => h("option", { key: axisIndex, value: String(axisIndex) }, AXIS_OPTION_LABELS[axisIndex]))))
            ),
            h("div", { className: "series-actions" },
                h("div", { className: "field" }, h("label", null, "Color"), h("input", { type: "color", value: item.color, onChange: (event) => updateSeries(item.id, { color: event.target.value }) })),
                h("button", { className: "danger-button full-width", type: "button", onClick: () => setSeries((current) => current.filter((entry) => entry.id !== item.id)) }, "Remove series")
            ),
            h("div", { className: "field label-input" }, h("label", null, "Label"), h("input", { value: item.label, onChange: (event) => updateSeries(item.id, { label: event.target.value }) }))
        ));

        return h("div", { className: "app-shell" },
            h("section", { className: "hero" },
                h("h1", null, "T-Plotter"),
                h("p", null, "By Abel Tomy and developed by Codex.")
            ),
            h("div", { className: "workspace" },
                h("aside", { className: "sidebar" },
                    h("section", { className: "section" },
                        h("h2", null, "Data File"),
                        h("input", { className: "file-input", type: "file", accept: ".csv,.xlsx,.xls", onChange: onFileChange }),
                        h("p", { className: "section-note" }, fileName || "No file loaded"),
                        h("div", { className: "field" },
                            h("label", null, "Sheet"),
                            h(
                                "select",
                                {
                                    value: sheet,
                                    disabled: !book || !book.sheetNames.length,
                                    onChange: (event) => applySheet(event.target.value, book ? (book.sheets[event.target.value] || []) : []),
                                },
                                !book || !book.sheetNames.length
                                    ? [h("option", { key: "no-sheet", value: "" }, "No sheet available")]
                                    : book.sheetNames.map((name) => h("option", { key: name, value: name }, name))
                            )
                        ),
                        book && book.sheetNames.length > 1
                            ? h("p", { className: "section-note" }, `${book.sheetNames.length} sheets detected`)
                            : null,
                        status ? h("div", { className: "status" }, status) : null
                    ),
                    h("section", { className: "section" }, h("h2", null, "Data Summary"), h("div", { className: "summary" }, summary)),
                    h("section", { className: "section" },
                        h("h2", null, "X-Axis"),
                        h("div", { className: "field" }, h("label", null, "Column"), h("select", { value: xColumn, onChange: (event) => setXColumn(event.target.value) }, columns.map((column) => h("option", { key: column, value: column }, column)))),
                        h("div", { className: "field" }, h("label", null, "X conversion"), h("select", { value: xMode, onChange: (event) => setXMode(event.target.value) }, Object.keys(SCALES).map((mode) => h("option", { key: mode, value: mode }, mode)))),
                        h("div", { className: "field" }, h("label", null, "Datetime reference"), h("select", { value: dtRef, onChange: (event) => setDtRef(event.target.value) }, DT_REFS.map((item) => h("option", { key: item, value: item }, item)))),
                        h("div", { className: "field" }, h("label", null, "Override label"), h("input", { value: xLabel, onChange: (event) => setXLabel(event.target.value), placeholder: "Optional custom X label" })),
                        h("div", { className: "field" }, h("label", null, "Min / Max"), h("input", { value: xMin, onChange: (event) => setXMin(event.target.value), placeholder: "Min" }), h("input", { value: xMax, onChange: (event) => setXMax(event.target.value), placeholder: "Max" })),
                        h("div", { className: "range-line" }, `Available range: ${xRange}`)
                    ),
                    h("section", { className: "section" },
                        h("h2", null, "Y-Axes"),
                        h("p", { className: "section-note" }, "Series tags use the same axis colors as the chart, so you can see which plot belongs to which Y-axis."),
                        h("div", { className: "button-row" }, axisButtons),
                        [0, 1, 2].slice(0, axisCount).map((axisIndex) => h("div", { className: "field", key: axisIndex },
                            h("div", { className: "series-tag", style: axisTagStyle(axisIndex) }, `Y${axisIndex + 1}`),
                            h("label", null, `Y${axisIndex + 1} label / unit`),
                            h("input", { value: yAxisMeta[axisIndex].label, onChange: (event) => updateYAxisMeta(axisIndex, "label", event.target.value), placeholder: "Optional axis label" }),
                            h("input", { value: yAxisMeta[axisIndex].unit, onChange: (event) => updateYAxisMeta(axisIndex, "unit", event.target.value), placeholder: "Unit" }),
                            h("label", null, `Y${axisIndex + 1} min / max`),
                            h("input", { value: yLimits[axisIndex].min, onChange: (event) => updateYLimit(axisIndex, "min", event.target.value), placeholder: yAxisMeta[axisIndex].unit.trim() ? `Min (${yAxisMeta[axisIndex].unit.trim()})` : "Min" }),
                            h("input", { value: yLimits[axisIndex].max, onChange: (event) => updateYLimit(axisIndex, "max", event.target.value), placeholder: yAxisMeta[axisIndex].unit.trim() ? `Max (${yAxisMeta[axisIndex].unit.trim()})` : "Max" }),
                            h("div", { className: "range-line" }, `Y${axisIndex + 1} range: ${yRanges[axisIndex]}`)
                        ))
                    ),
                    h("section", { className: "section" },
                        h("h2", null, "Series"),
                        h("p", { className: "section-note" }, "Pick a column, choose the axis, and set the label."),
                        h("div", { className: "series-list" }, seriesCards),
                        h("div", { className: "button-row" }, h("button", {
                            className: "button",
                            type: "button",
                            disabled: !columns.length,
                            onClick: () => setSeries((current) => [...current, createSeriesItem(columns.find((column) => column !== xColumn) || columns[0] || "", current.length)]),
                        }, "Add Series"))
                    ),
                    h("section", { className: "section" },
                        h("h2", null, "Plot Options"),
                        h("div", { className: "field" }, h("label", null, "Title"), h("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Optional chart title" })),
                        h("div", { className: "toggle-row" },
                            h("label", { className: "toggle" }, h("input", { type: "checkbox", checked: showLegend, onChange: (event) => setShowLegend(event.target.checked) }), "Legend"),
                            h("label", { className: "toggle" }, h("input", { type: "checkbox", checked: showGrid, onChange: (event) => setShowGrid(event.target.checked) }), "Grid")
                        )
                    ),
                    h("section", { className: "section" },
                        h("button", {
                            className: showAdvanced ? "button advanced-toggle" : "ghost-button advanced-toggle",
                            disabled: !rows.length,
                            type: "button",
                            onClick: () => setShowAdvanced((current) => !current),
                        }, showAdvanced ? "Advanced Hide" : "Advanced"),
                        showAdvanced ? h("div", { className: "advanced-panel" },
                            h("div", { className: "advanced-group" },
                                h("h2", null, "Annotations"),
                                h("p", { className: "section-note" }, "Add notes inside the graph. You can also drag them directly on the plot."),
                                annotations.length ? h("div", { className: "series-list" }, annotationCards) : h("p", { className: "section-note" }, "No notes added yet."),
                                h("div", { className: "button-row" }, h("button", {
                                    className: "button",
                                    type: "button",
                                    onClick: () => setAnnotations((current) => [...current, createAnnotationItem(current.length)]),
                                }, "Add Note"))
                            ),
                            h("div", { className: "advanced-group" },
                                h("h2", null, "Lines"),
                                h("p", { className: "section-note" }, "Add guide lines using the current plot X values and the selected Y-axis values."),
                                guideLines.length ? h("div", { className: "series-list" }, guideLineCards) : h("p", { className: "section-note" }, "No lines added yet."),
                                h("div", { className: "button-row" }, h("button", {
                                    className: "button",
                                    type: "button",
                                    onClick: () => setGuideLines((current) => [...current, createGuideLineItem(current.length)]),
                                }, "Add Line"))
                            )
                        ) : null
                    )
                ),
                h("section", { className: "plot-panel" },
                    h("div", { className: "plot-meta" },
                        h("div", { className: "plot-meta-primary" },
                            h("div", { className: "plot-meta-title" }, sourceMeta),
                            h("div", null, sheetMeta)
                        ),
                        h("div", { className: "plot-meta-actions" },
                            h("button", { className: "ghost-button", type: "button", disabled: !rows.length, onClick: clearPlotSettings }, "Reset Plot"),
                            h("button", { className: "button", type: "button", disabled: !canPlot, onClick: downloadPng }, "Download PNG"),
                            plotStats.map((item) => h("div", { className: "meta-chip", key: item.label }, `${item.label}: ${item.value}`))
                        )
                    ),
                    h("div", { className: "plot-card" }, canPlot
                        ? h("div", { ref: plotRef, style: { width: "100%", height: "100%" } })
                        : h("div", { className: "empty-state" },
                            h("div", null,
                                h("strong", null, rows.length ? "Choose an X column and at least one series." : "No data loaded yet."),
                                h("div", null, rows.length ? "Finish the required plot inputs to render the chart." : "Drop in a CSV or Excel file to start plotting.")
                            )
                        ))
                )
            )
        );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();

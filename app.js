(function () {
    "use strict";

    const { createElement: h, useEffect, useMemo, useRef, useState } = React;
    const COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b"];
    const AXIS_COLORS = ["#303030", "#d95f02", "#1b9e77"];
    const SCALES = { Original: null, Milliseconds: 0.001, Seconds: 1, Minutes: 60, Hours: 3600, Days: 86400 };
    const DT_REFS = ["First value", "Start of day", "Start of month"];
    const AXIS_OPTION_LABELS = ["Y1 - Left", "Y2 - Right", "Y3 - Outer right"];

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
        const [yLimits, setYLimits] = useState([{ min: "", max: "" }, { min: "", max: "" }, { min: "", max: "" }]);
        const [series, setSeries] = useState([]);
        const [title, setTitle] = useState("");
        const [xLabel, setXLabel] = useState("");
        const [showLegend, setShowLegend] = useState(true);
        const [showGrid, setShowGrid] = useState(true);
        const [status, setStatus] = useState("");

        const summary = useMemo(() => {
            if (!rows.length || !columns.length) {
                return "Load a CSV or Excel file to inspect rows, columns, and numeric columns.";
            }
            const numericCols = columns.filter((column) => types[column] === "numeric");
            return `Rows: ${rows.length}\nColumns: ${columns.length}\nNumeric columns: ${numericCols.length ? numericCols.join(", ") : "None detected"}`;
        }, [rows, columns, types]);

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
            if (!rows.length || !series.length || !xColumn) {
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
                name: item.label || item.column,
                line: { color: item.color, width: 2.2 },
                yaxis: item.axis === 0 ? "y" : `y${item.axis + 1}`,
            }));

            const layout = {
                title: title || undefined,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "#ffffff",
                margin: { l: 60, r: axisCount > 1 ? 100 + (axisCount - 2) * 50 : 40, t: 64, b: 56 },
                showlegend: showLegend,
                legend: { orientation: "h", y: 1.12, x: 0 },
                xaxis: {
                    title: xLabel || preparedX.label,
                    gridcolor: showGrid ? "rgba(24,33,39,0.08)" : "rgba(0,0,0,0)",
                    zeroline: false,
                    ...(xAxisRange ? { range: xAxisRange } : {}),
                },
                yaxis: {
                    title: "Y1",
                    color: AXIS_COLORS[0],
                    gridcolor: showGrid ? "rgba(24,33,39,0.08)" : "rgba(0,0,0,0)",
                    zeroline: false,
                    ...(yAxisRanges[0] ? { range: yAxisRanges[0] } : {}),
                },
            };

            if (axisCount >= 2) {
                layout.yaxis2 = {
                    title: "Y2",
                    titlefont: { color: AXIS_COLORS[1] },
                    tickfont: { color: AXIS_COLORS[1] },
                    overlaying: "y",
                    side: "right",
                    zeroline: false,
                    ...(yAxisRanges[1] ? { range: yAxisRanges[1] } : {}),
                };
            }

            if (axisCount >= 3) {
                layout.yaxis3 = {
                    title: "Y3",
                    titlefont: { color: AXIS_COLORS[2] },
                    tickfont: { color: AXIS_COLORS[2] },
                    overlaying: "y",
                    side: "right",
                    anchor: "free",
                    position: 1,
                    autoshift: true,
                    zeroline: false,
                    ...(yAxisRanges[2] ? { range: yAxisRanges[2] } : {}),
                };
            }

            Plotly.react(plotRef.current, traces, layout, { responsive: true, displaylogo: false });
        }, [rows, series, xColumn, preparedX, axisCount, xMin, xMax, yLimits, title, xLabel, showLegend, showGrid]);

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
            const numericCols = nextColumns.filter((column) => nextTypes[column] === "numeric");
            setSeries(numericCols.slice(0, 4).map((column, index) => ({
                id: `${column}-${index}-${Date.now()}`,
                column,
                axis: 0,
                label: column,
                color: COLORS[index % COLORS.length],
            })));
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

        function downloadPng() {
            if (!plotRef.current) {
                return;
            }
            Plotly.downloadImage(plotRef.current, {
                format: "png",
                filename: "timeseries-plotter",
                width: 1400,
                height: 820,
            });
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

        const seriesCards = series.map((item, index) => h("div", { className: "series-row", key: item.id },
            h("div", { className: "series-heading" },
                h("strong", null, `Series ${index + 1}`),
                h("span", { className: "series-tag" }, AXIS_OPTION_LABELS[item.axis] || "Y1 - Left")
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
                h("p", null, "By Abel Tomy and codevloped by Codex.")
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
                        h("div", { className: "button-row" }, axisButtons),
                        [0, 1, 2].slice(0, axisCount).map((axisIndex) => h("div", { className: "field", key: axisIndex },
                            h("label", null, `Y${axisIndex + 1} min / max`),
                            h("input", { value: yLimits[axisIndex].min, onChange: (event) => updateYLimit(axisIndex, "min", event.target.value), placeholder: "Min" }),
                            h("input", { value: yLimits[axisIndex].max, onChange: (event) => updateYLimit(axisIndex, "max", event.target.value), placeholder: "Max" }),
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
                            onClick: () => setSeries((current) => [...current, { id: `series-${Date.now()}-${current.length}`, column: columns.find((column) => column !== xColumn) || columns[0] || "", axis: 0, label: columns.find((column) => column !== xColumn) || columns[0] || "", color: COLORS[current.length % COLORS.length] }]),
                        }, "Add Series"))
                    ),
                    h("section", { className: "section" },
                        h("h2", null, "Plot Options"),
                        h("div", { className: "field" }, h("label", null, "Title"), h("input", { value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Optional chart title" })),
                        h("div", { className: "toggle-row" },
                            h("label", { className: "toggle" }, h("input", { type: "checkbox", checked: showLegend, onChange: (event) => setShowLegend(event.target.checked) }), "Legend"),
                            h("label", { className: "toggle" }, h("input", { type: "checkbox", checked: showGrid, onChange: (event) => setShowGrid(event.target.checked) }), "Grid")
                        )
                    )
                ),
                h("section", { className: "plot-panel" },
                    h("div", { className: "plot-meta" },
                        h("div", null, fileName ? `Source: ${fileName}` : "Source: none"),
                        h("div", { className: "plot-meta-actions" },
                            h("div", null, sheet ? `Sheet: ${sheet}` : "Sheet: -"),
                            h("button", { className: "button", type: "button", onClick: downloadPng }, "Download PNG")
                        )
                    ),
                    h("div", { className: "plot-card" }, rows.length ? h("div", { ref: plotRef, style: { width: "100%", height: "100%" } }) : h("div", { className: "empty-state" }, h("div", null, h("strong", null, "No data loaded yet."), h("div", null, "Drop in a CSV or Excel file to start plotting."))))
                )
            )
        );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();

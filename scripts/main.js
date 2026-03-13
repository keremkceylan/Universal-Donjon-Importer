// 1. UI: Add our module's button to the left menu
Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user.isGM) return;

    const wallControls = controls.find(c => c.name === "walls");
    if (wallControls) {
        wallControls.tools.push({
            name: "import-donjon",
            title: "Import Donjon Map",
            icon: "icon-donjon-custom", 
            visible: true, 
            button: true,
            onClick: () => openImporterDialog()
        });
    }
});

// 2. USER INTERFACE: With added Manual Offset fields
function openImporterDialog() {
    // Try to auto-detect scene offsets, but allow user to override
    const autoX = canvas.dimensions?.sceneX || 0;
    const autoY = canvas.dimensions?.sceneY || 0;

    new Dialog({
        title: "Universal Donjon Importer",
        content: `
            <form style="margin-bottom: 10px;">
                <div class="form-group">
                    <label><b>Donjon JSON File:</b></label>
                    <input type="file" id="donjon-file-upload" accept=".json" />
                </div>
                <div class="form-group">
                    <label><b>Donjon Cell Size (Px):</b></label>
                    <input type="number" id="donjon-grid-size" value="50" />
                </div>
                <hr>
                <p><i>Adjust offsets if walls don't align with the image:</i></p>
                <div class="form-group">
                    <label><b>Manual Offset X:</b></label>
                    <input type="number" id="donjon-offset-x" value="${autoX}" />
                </div>
                <div class="form-group">
                    <label><b>Manual Offset Y:</b></label>
                    <input type="number" id="donjon-offset-y" value="${autoY}" />
                </div>
            </form>
        `,
        buttons: {
            import: {
                icon: '<i class="fas fa-hammer"></i>',
                label: "Build Map",
                callback: (html) => processFile(html)
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "import"
    }).render(true);
}

// 3. MAIN ENGINE: Enhanced with Manual Offset logic
async function processFile(html) {
    const fileInput = html.find("#donjon-file-upload")[0];
    const gridSize = parseInt(html.find("#donjon-grid-size").val()) || 50;
    const offsetX = parseInt(html.find("#donjon-offset-x").val()) || 0;
    const offsetY = parseInt(html.find("#donjon-offset-y").val()) || 0;

    if (!fileInput.files.length) {
        ui.notifications.warn("Please select a JSON file!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const mapData = JSON.parse(e.target.result);
            const bleed = mapData.settings.bleed || 0;
            const cells = mapData.cells;
            
            let rawWalls = [];
            let foundryDoors = [];

            const isWalkable = (val) => (val & 2) !== 0 || (val & 4) !== 0;

            // EDGE DETECTION
            for (let y = 0; y < cells.length; y++) {
                for (let x = 0; x < cells[0].length; x++) {
                    let current = isWalkable(cells[y][x]);
                    if (x + 1 < cells[0].length && current !== isWalkable(cells[y][x + 1])) {
                        rawWalls.push({
                            x1: ((x + 1) * gridSize) + offsetX, y1: (y * gridSize) + offsetY,
                            x2: ((x + 1) * gridSize) + offsetX, y2: ((y + 1) * gridSize) + offsetY
                        });
                    }
                    if (y + 1 < cells.length && current !== isWalkable(cells[y + 1][x])) {
                        rawWalls.push({
                            x1: (x * gridSize) + offsetX,       y1: ((y + 1) * gridSize) + offsetY,
                            x2: ((x + 1) * gridSize) + offsetX, y2: ((y + 1) * gridSize) + offsetY
                        });
                    }
                }
            }

            // DOORS
            const getDoorSettings = (type) => {
                const types = { "door": [1,0], "locked": [1,2], "secret": [2,0], "trapped": [1,2], "portcullis": [1,2] };
                return types[type] ? { door: types[type][0], ds: types[type][1] } : null;
            };

            let processedDoors = new Set();
            if (mapData.rooms) {
                mapData.rooms.forEach(room => {
                    if (!room || !room.doors) return;
                    for (const [dir, doors] of Object.entries(room.doors)) {
                        doors.forEach(door => {
                            let ds = getDoorSettings(door.type);
                            if (!ds || processedDoors.has(`${door.col},${door.row}`)) return;
                            processedDoors.add(`${door.col},${door.row}`);

                            let c = door.col + bleed, r = door.row + bleed;
                            let x1, y1, x2, y2;

                            if (dir === "east" || dir === "west") {
                                x1 = x2 = ((c + 0.5) * gridSize) + offsetX;
                                y1 = (r * gridSize) + offsetY; y2 = ((r + 1) * gridSize) + offsetY;
                            } else {
                                y1 = y2 = ((r + 0.5) * gridSize) + offsetY;
                                x1 = (c * gridSize) + offsetX; x2 = ((c + 1) * gridSize) + offsetX;
                            }
                            foundryDoors.push({ c: [x1, y1, x2, y2], door: ds.door, ds: ds.ds });
                        });
                    }
                });
            }

            // OPTIMIZATION & CREATION
            const optimize = (walls) => {
                let h = walls.filter(w => w.y1 === w.y2).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
                let v = walls.filter(w => w.x1 === w.x2).sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);
                const merge = (list, isH) => {
                    if (list.length === 0) return [];
                    let res = [], cur = { ...list[0] };
                    for (let i = 1; i < list.length; i++) {
                        let n = list[i];
                        if ((isH ? cur.y1 === n.y1 && cur.x2 >= n.x1 : cur.x1 === n.x1 && cur.y2 >= n.y1)) {
                            isH ? cur.x2 = Math.max(cur.x2, n.x2) : cur.y2 = Math.max(cur.y2, n.y2);
                        } else { res.push(cur); cur = { ...n }; }
                    }
                    res.push(cur); return res;
                };
                return [...merge(h, true), ...merge(v, false)];
            };

            const finalWalls = optimize(rawWalls).map(w => ({ c: [w.x1, w.y1, w.x2, w.y2], door: 0, ds: 0 }));
            await canvas.scene.createEmbeddedDocuments("Wall", [...finalWalls, ...foundryDoors]);
            ui.notifications.info("Build complete!");

        } catch (error) {
            console.error(error);
            ui.notifications.error("Processing failed.");
        }
    };
    reader.readAsText(file);
}
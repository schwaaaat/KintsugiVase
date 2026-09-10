# **🏺 KintsugiVase Splicer**

**A Universal Toolpath Editor for combining the strength of solid prints with the beauty and speed of spiral vase mode.**


Standard "Spiral Vase Mode" is gorgeous and prints incredibly fast but forces your entire model to have zero infill and a single wall. There have been times while desigining objects that I wished I could print them with multiple walls and complex shapes at the base before transitioning to vase mode for the remainder of the print. **KintsugiVase Splicer** enables this capability by letting you splice two G-code files together directly in your browser.

You can print a dense, heavy, perfectly solid base (ideal for stability, complex internal geometry, threading, or water-tightness) and instantly transition into a seamless, single-wall spiral for the upper aesthetics.

Try an online demo here: [https://schwaaaat.github.io/KintsugiVase/](https://schwaaaat.github.io/KintsugiVase/)

Choose **Demo pair 1** or **Demo pair 2**, then click **Load pair** beside the upload boxes. Each option loads its matching **Standard base** and **Vase** OrcaSlicer archives together.

![](/images/hero-screenshot.png)

## **✨ Features**

* **Zero Installation:** It's a single, self-contained HTML file. Open it in any modern web browser.
* **Full 3D Toolpath Preview:** Built-in Three.js visualizer allows you to inspect the spliced toolpath line-by-line, visualizing speed, flow, and temperature.
* **LAN Mode Ready (.gcode.3mf):** Fully supports editing the G-code *inside* Orca Slicer or Bambu Studio .gcode.3mf exports, meaning your slicer thumbnails are preserved and you can still send the file directly to your printer over Wi-Fi/LAN.
* **Advanced Transition Tuning:** Single-wall prints often struggle to grip onto 100% solid bases. Use the explicit Wall Width tuner or Speed Tuning controls to smoothly ramp speeds and inject more plastic exactly where it's needed to prevent layer separation.
* **Contour-Aligned Level Junctions:** Base→Vase prints one complete flat loop on the actual base outer wall before a full rising turn blends back into the source spiral. Vase→Base reshapes the preceding spiral turn onto the incoming base contour, then closes with a flat support rim whose flow ramps away from and back into the seam.
* **Ordered Multi-Mode Bands:** Add as many transition heights as the model permits and choose either Base or Vase as the bottom section to produce Base→Vase→Base or Vase→Base→Vase sequences.
* **Direction-Aware Layer Correction:** If changing the starting mode makes a single selected transition invalid, the app finds the nearest layer that produces a valid junction and shows the adjustment in the result status.
* **P1S Archive Integrity:** Exported `.gcode.3mf` files retain the Orca/Bambu model, thumbnails, and settings while replacing the embedded toolpath and updating its `.gcode.md5` checksum.
* **Built-in Example Pairs:** The hosted app includes two ready-to-use Standard base and Vase `.gcode.3mf` pairs.

## **🚀 How to Use It**

1. **Slicer Setup:** Enable Verbose G-code export.
* **Bambu Studio / OrcaSlicer:** Others tab \-\> G-code output \-\> Verbose G-code
* **PrusaSlicer:** Print Settings \-\> Output options \-\> Verbose G-code
2. **Model Setup:** Place your model on the build plate in your slicer. *Do not move it once it is placed\!*
3. **Slice the Base:** Configure your slicer for standard printing (e.g., 2 perimeters, 15% infill). Ensure seam position is set to **Aligned** or **Aligned back** and top surface is set to **Concentric**. Slice the file and export it.
4. **Slice the Vase:** Without moving the model, turn on "Spiral Vase Mode" and make any changes necessary for vase mode printing like increased wall width, slower wall speed, etc. Enabling "Smooth Spiral" typically improves results. Slice the file again and export it.
***Note:*** While you can change some of these settings like wall width and speed in **KintsugiVase**, when possible it is always better to change them in the slicer before export.
5. **Splice:** Open index.html. Upload your Base file, upload your Vase file, choose the exact Z-height where you want the transition to occur, and click "Splice & Generate Preview".

The default **Level Bonding / Support Loop** option requires verbose outer-wall feature labels and seam matching. If the engine cannot identify a complete corresponding base contour, it stops with an error instead of generating a weaker travel transition. Use **Inspect Junction** to review the generated flat loop, blend turn, and incoming wall before printing.

The TypeScript UI retains the legacy workflow conveniences: settings and per-junction edits persist locally, playback keeps the Z and LayerBuild controls synchronized, the Z control supports wheel/arrow layer stepping, and vase-width detection prioritizes slicer outer-wall metadata.

The header contains two optional learning tools. **Help & Settings Guide** opens the complete in-app reference, while **Walkthrough** highlights the live controls step by step. Neither opens automatically.

## **Control Reference**

| Control | Purpose |
| --- | --- |
| Demo pair / Load pair | Loads both matching Standard base and Vase archives from one of the built-in examples. |
| Bottom Section | Chooses Base-first or Vase-first order. Additional transition heights alternate modes. If changing order invalidates a height, the next splice finds the nearest working layer and reports the change. |
| Transition Heights | Defines every handoff. Values snap to real base layers; Up/Down steps adjacent layers. Select a row before using Set Trans. or per-junction controls. |
| Vase Flow Multiplier | Scales extrusion throughout vase-sourced sections. |
| Wall Thickness Tuning | Detects the sliced vase line width and multiplies flow toward the requested target width. |
| Level Bonding / Support Loop | Base→Vase adds a complete flat outer-wall bond before climbing. Vase→Base flattens the final spiral turn and adds a complete support rim. |
| Hop / Travel / Prime | Controls fallback seam movement. A successfully matched planar junction avoids XY travel and retraction at the handoff. |
| Flow Taper | Ramps extrusion from Taper Start Flow to full flow over Taper Distance. |
| Seam Matching | Relocates both paths to a common outer-wall seam. The before/after values set the vertical search window; Base→Vase searches forward only. |
| Scarf Lap Joint | Overlaps complementary tapering beads over the selected contour distance. |
| Tangential Lead-In | Approaches the perimeter from inside the part and wipes onto it; offset sets the inside distance. |
| Speed Tuning | Applies the transition speed as an instant step or smooth ramp over the requested layers before and after. |
| Transition Temp / Fan | Overrides temperature or fan near a junction. Blank fields inherit the source G-code. |
| Bed X / Y | Changes only the preview build-plate dimensions. |
| Material Density | Changes only the estimated filament weight. |
| Selected Junction | Overrides shared settings for one transition and exposes generated, before, replacement, and after G-code editors. |
| Color Mode | Colors the toolpath by Base/Vase source, speed, flow, width, height, or temperature and remains selected after resplicing. |
| Z slider / Set Trans. | Filters the visible height and assigns that real layer to the selected transition. Wheel or Up/Down steps layers. |
| LayerBuild | Reveals the ordered moves within the selected layer. Left/Right steps through those moves. |
| Playback | Animates toolpath construction at the selected speed. |
| Inspect Junction | Zooms to the selected handoff and plays the nearby toolpath. |
| Save .gcode | Downloads plain edited G-code. |
| Save .gcode.3mf | Replaces the toolpath in the source archive while retaining model, settings, thumbnails, and an updated MD5 sidecar. |

Per-junction fields left blank inherit shared settings. Custom before/after code wraps the generated block; replacing the junction body gives full control while protecting the app's reserved transition markers.

## **⚠️ Crucial Slicer Settings**

For this tool to successfully read your layer heights and blend the models perfectly, **you must configure these settings in your slicer before exporting.**

### **1\. Enable "Verbose G-code"**

This tool relies on exact Z-height tracking. It reads the comments your slicer leaves behind.

* **Bambu Studio / OrcaSlicer:** Others tab \-\> G-code output \-\> Verbose G-code
![Verbose G-code](/images/verbose-gcode-setting.png)
* **PrusaSlicer:** Print Settings \-\> Output options \-\> Verbose G-code

### **2\. Aligned Seams & Concentric Tops**

To prevent the nozzle from dragging across the print or leaving tiny gaps during the transition:

* **Seam Position:** Set to **Aligned** or **Back** for *both* files.
* **Top Surface Pattern:** Set the Base file's Top Surface Pattern to **Concentric**. This forces the solid infill to perfectly trace the outer wall right before the vase section starts.
![Concentric](/images/concentric-top.png)

## **💡 Ideal Projects**

* **Threaded Fittings & Jars:** Print a 100% solid base with complex internal geometry (threads, snap-fits) that transitions into a lightweight single-wall structure above.
* **Weighted Planters:** Heavy, water-tight bases with infill to hold soil securely, transitioning into a geometric vase top.
* **Lamp Shades:** A thick, solid mounting ring at the bottom to attach to a light socket, transitioning into a thin, translucent spiral shade.

### **Real World Examples**

![Real world printed example:](/images/real-print-example1.jpg)
![Real world printed example 2:](/images/real-print-example2.jpg)

## **🛠️ Building From Source**

The app is a single self-contained HTML file (`index.html`), built with Vite from `index.dev.html`.

```bash
npm install
npm test          # Vitest unit/regression suite
npm run build     # produces dist/index.dev.html and updates index.html
```

`test/e2e_ui_parity.mjs` is a Playwright end-to-end regression covering persistence, camera behavior, junction editing, and 3MF round-tripping. It launches a local browser, so it may prompt for permission the first time you run it:

```bash
node test/e2e_ui_parity.mjs
```

## **Disclaimer**

*Generating and executing custom, spliced G-code can result in unexpected toolhead movements. Use this tool entirely at your own risk. Always closely supervise your 3D printer during the transition layers when testing new spliced files.*

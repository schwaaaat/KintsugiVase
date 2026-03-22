# **🏺 KintsugiVase Splicer**

**A Universal Toolpath Editor for combining the strength of solid prints with the beauty and speed of spiral vase mode.**

Standard "Spiral Vase Mode" is gorgeous and prints incredibly fast, but it is structurally weak. It forces your entire model to have zero infill and no solid bottom. **KintsugiVase Splicer** solves this by letting you "splice" two G-code files together directly in your browser.

You can print a dense, heavy, perfectly solid base (ideal for stability, complex internal geometry, threading, or water-tightness) and instantly transition into a seamless, single-wall spiral for the upper aesthetics.  

![](/images/hero-screenshot.png)

## **✨ Features**

* **Zero Installation:** It's a single, self-contained HTML file. Open it in any modern web browser.  
* **Full 3D Toolpath Preview:** Built-in Three.js visualizer allows you to inspect the spliced toolpath line-by-line, visualizing speed, flow, and temperature.  
* **LAN Mode Ready (.gcode.3mf):** Fully supports editing the G-code *inside* Bambu Studio .3mf exports, meaning your slicer thumbnails are preserved and you can still send the file directly to your printer over Wi-Fi/LAN (Perfect for Bambu P1S/X1C users).  
* **Advanced Transition Tuning:** Single-wall prints often struggle to grip onto 100% solid bases. Use the explicit Wall Width tuner or Speed Tuning controls to smoothly ramp speeds and inject more plastic exactly where it's needed to prevent layer separation.

## **🚀 How to Use It**

1. **Slicer Setup:** Enable Verbose G-code export. 
* **Bambu Studio / OrcaSlicer:** Others tab \-\> G-code output \-\> Verbose G-code  
* **PrusaSlicer:** Print Settings \-\> Output options \-\> Verbose G-code
2. **Model Setup:** Place your model on the build plate in your slicer. *Do not move it once it is placed\!*  
3. **Slice the Base:** Configure your slicer for standard printing (e.g., 2 perimeters, 15% infill). Ensure seam position is set to **Aligned** or **Aligned back** and top surface is set to **Concentric**. Slice the file and export it.  
4. **Slice the Vase:** Without moving the model, turn on "Spiral Vase Mode" and make any changes necessary for vase mode printing like increased wall width, slower wall speed, etc. Also enabling "Smooth Spiral" will typically improve results. Slice the file again and export it.                                                              
(**Note:** While you can change some of these settings like wall width and speed in **KintsugiVase**, it is always better to change them in the slicer before export when possible.)  
![](/images/smooth-spiral.png)
5. **Splice:** Open index.html. Upload your Base file, upload your Vase file, choose the exact Z-height where you want the transition to occur, and click "Splice & Generate Preview".

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

### **Disclaimer**

*Generating and executing custom, spliced G-code can result in unexpected toolhead movements. Use this tool entirely at your own risk. Always closely supervise your 3D printer during the transition layers when testing new spliced files.* 

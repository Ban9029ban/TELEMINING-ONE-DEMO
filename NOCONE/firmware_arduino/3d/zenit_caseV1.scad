//
// Enclosure ZENIT-URTS-B + logo TELEMINING
// Autor: ChatGPT & Felipe
// Unidades en mm
//

// ==================== DATOS REALES DE LA PCB ====================
// Mídelo en EasyEDA y pon aquí los valores correctos
pcb_len      = 160;    // largo de la PCB
pcb_wid      = 50;     // ancho de la PCB
pcb_thick    = 1.6;    // grosor típico

// Distancia de los hoyos de fijación a los bordes de la PCB
hole_edge_x  = 5;      // desde el lado corto (izq/der)
hole_edge_y  = 5;      // desde el lado largo (arriba/abajo)

// ==================== PARÁMETROS DE LA CAJA ====================
wall         = 2.0;    // grosor de pared
clearance    = 1.0;    // holgura alrededor de la placa
bottom_thick = 3.0;    // “piso” de la base
inner_h      = 14.0;   // espacio libre interior sobre la PCB

standoff_d   = 6.0;    // diámetro de los pilares
standoff_h   = pcb_thick + 5.0; // altura de los pilares
screw_d      = 3.0;    // agujero para tornillos M3

// Tapa
lid_thick    = 3.0;
logo_height  = 1.5;    // altura del relieve 3D del logo
logo_size    = 12;     // tamaño texto TELEMINING

// ==================== DIMENSIONES DERIVADAS ====================
case_len  = pcb_len + 2*(wall + clearance);
case_wid  = pcb_wid + 2*(wall + clearance);
case_h    = bottom_thick + inner_h;

board_off_x = wall + clearance;
board_off_y = wall + clearance;

// Posiciones de hoyos (sobre la base)
hole_pos = [
    [board_off_x + hole_edge_x,                       board_off_y + hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,             board_off_y + hole_edge_y],
    [board_off_x + hole_edge_x,                       board_off_y + pcb_wid - hole_edge_y],
    [board_off_x + pcb_len - hole_edge_x,             board_off_y + pcb_wid - hole_edge_y]
];

// ==================== MÓDULOS ====================

module standoffs() {
    for (p = hole_pos) {
        translate([p[0], p[1], bottom_thick])
            difference() {
                cylinder(h = standoff_h, d = standoff_d, $fn = 40);
                cylinder(h = standoff_h + 0.1, d = screw_d, $fn = 30);
            }
    }
}

module base() {
    // Caja exterior
    difference() {
        // sólido exterior
        cube([case_len, case_wid, case_h], center = false);

        // hueco interior
        translate([wall, wall, bottom_thick])
            cube([case_len - 2*wall,
                  case_wid - 2*wall,
                  case_h - bottom_thick], center = false);

        // opcional: rebaje suave de entrada de cables en un costado
        //translate([-0.1, case_wid/2 - 10, bottom_thick + 4])
        //    cube([wall+0.2, 20, 8], center=false);
    }

    // Pilares de la PCB
    standoffs();
}

module lid() {
    // Tapa plana que apoya sobre las paredes de la base
    difference() {
        translate([0,0,case_h])
            cube([case_len, case_wid, lid_thick], center=false);

        // Agujeros para tornillos coincidentes con los standoffs
        for (p = hole_pos) {
            translate([p[0], p[1], case_h - 0.1])
                cylinder(h = lid_thick + 0.5, d = screw_d + 0.3, $fn = 30);
        }
    }

    // Logo TELEMINING en relieve
    telemining_logo();
}

module telemining_logo() {
    // Centro del logo: parte izquierda de la tapa, zona “branding”
    logo_x = case_len * 0.32;
    logo_y = case_wid * 0.5;

    // Texto
    translate([logo_x, logo_y, case_h + lid_thick])
        linear_extrude(height = logo_height)
            text("TELEMINING",
                 size = logo_size,
                 halign = "center",
                 valign = "center",
                 font = "Liberation Sans:Bold");

    // Rayos (tipo “sol”) alrededor del punto sobre la letra “I”
    ray_radius = logo_size * 0.9;
    ray_len    = logo_size * 0.5;
    ray_width  = logo_size * 0.12;

    for (a = [0:45:315]) {
        translate([logo_x, logo_y, case_h + lid_thick])
            rotate([0,0,a])
                translate([ray_radius,0,0])
                    linear_extrude(height = logo_height)
                        square([ray_len, ray_width], center=true);
    }
}

// ==================== ENSAMBLAJE ====================

// Para ver todo armado:
base();
lid();

// Para exportar solo una pieza comenta las otras:
//base();            // exportar STL de la base
//lid();             // exportar STL de la tapa

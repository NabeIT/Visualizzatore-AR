#!/usr/bin/env python3
import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


BOX_UV_SCALE = 1.0
WOOD_U_REPEAT = 2.0
WOOD_V_REPEAT = 6.0
AR_TEXTURE_BRIGHTNESS = 1.18
AR_TEXTURE_LIFT = 0.035
DEFAULT_TEXTURE_PATH = Path("public/textures/wood.jpg")


def read_glb_json(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a GLB file")

    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.decode("utf-8").rstrip("\x00 "))

    raise ValueError(f"{path} does not contain a JSON chunk")


def default_scene_mesh_node_names(glb_json):
    scene_index = glb_json.get("scene", 0)
    scene = glb_json.get("scenes", [{}])[scene_index]
    nodes = glb_json.get("nodes", [])
    names = set()

    def visit(node_index):
        node = nodes[node_index]
        if "mesh" in node and node.get("name"):
            names.add(node["name"])
        for child_index in node.get("children", []):
            visit(child_index)

    for node_index in scene.get("nodes", []):
        visit(node_index)

    return names


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    for scene in list(bpy.data.scenes):
        if scene != bpy.context.scene:
            bpy.data.scenes.remove(scene)


def keep_default_scene_objects(allowed_names):
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]

    if allowed_names:
        selected = [obj for obj in mesh_objects if obj.name in allowed_names]
        if selected:
            for obj in mesh_objects:
                if obj not in selected:
                    bpy.data.objects.remove(obj, do_unlink=True)
            mesh_objects = selected

    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)

    return mesh_objects


def world_bounds(objects):
    min_corner = Vector((math.inf, math.inf, math.inf))
    max_corner = Vector((-math.inf, -math.inf, -math.inf))

    for obj in objects:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ Vector(corner)
            min_corner.x = min(min_corner.x, world_corner.x)
            min_corner.y = min(min_corner.y, world_corner.y)
            min_corner.z = min(min_corner.z, world_corner.z)
            max_corner.x = max(max_corner.x, world_corner.x)
            max_corner.y = max(max_corner.y, world_corner.y)
            max_corner.z = max(max_corner.z, world_corner.z)

    return min_corner, max_corner


def center_on_ground(objects):
    min_corner, max_corner = world_bounds(objects)
    offset = Vector(
        (
            (min_corner.x + max_corner.x) * 0.5,
            (min_corner.y + max_corner.y) * 0.5,
            min_corner.z,
        )
    )

    for obj in objects:
        obj.location -= offset

    bpy.context.view_layer.update()


def create_wood_material(texture_path):
    material = bpy.data.materials.new("Nabe Wood")
    material.use_nodes = True

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")

    image = bpy.data.images.load(str(texture_path))
    texture_node = nodes.new(type="ShaderNodeTexImage")
    texture_node.image = image
    texture_node.extension = "REPEAT"

    if bsdf:
        links.new(texture_node.outputs["Color"], bsdf.inputs["Base Color"])
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = 0.0
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.74
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = 1.0

    return material


def create_ar_texture(texture_path, brightness, lift):
    if abs(brightness - 1.0) < 0.001 and abs(lift) < 0.001:
        return texture_path

    texture_key = f"b{round(brightness * 100):03d}-l{round(lift * 1000):03d}"
    output_path = texture_path.with_name(f"{texture_path.stem}-ar-{texture_key}{texture_path.suffix}")

    source = bpy.data.images.load(str(texture_path))
    source.colorspace_settings.name = "sRGB"
    width, height = source.size
    pixels = list(source.pixels)
    adjusted = pixels[:]

    for index in range(0, len(adjusted), 4):
        adjusted[index] = min(1.0, adjusted[index] * brightness + lift)
        adjusted[index + 1] = min(1.0, adjusted[index + 1] * brightness + lift)
        adjusted[index + 2] = min(1.0, adjusted[index + 2] * brightness + lift)

    image = bpy.data.images.new(output_path.stem, width, height, alpha=True)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(adjusted)
    image.filepath_raw = str(output_path)
    image.file_format = "JPEG"
    image.save()

    bpy.data.images.remove(source)
    bpy.data.images.remove(image)
    return output_path


def make_single_material(objects, material):
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0


def assign_box_uvs(objects):
    for obj in objects:
        mesh = obj.data
        uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()

        for polygon in mesh.polygons:
            world_normal = (normal_matrix @ polygon.normal).normalized()
            axis = max(range(3), key=lambda index: abs(world_normal[index]))

            for loop_index in polygon.loop_indices:
                loop = mesh.loops[loop_index]
                world_position = obj.matrix_world @ mesh.vertices[loop.vertex_index].co

                if axis == 0:
                    uv = (world_position.y, world_position.z)
                elif axis == 1:
                    uv = (world_position.x, world_position.z)
                else:
                    uv = (world_position.x, world_position.y)

                uv_layer.data[loop_index].uv = (
                    uv[0] * BOX_UV_SCALE * WOOD_U_REPEAT,
                    uv[1] * BOX_UV_SCALE * WOOD_V_REPEAT,
                )

        mesh.update()


def apply_transforms(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export_usdz(output_path):
    bpy.ops.wm.usd_export(
        filepath=str(output_path),
        selected_objects_only=False,
        export_animation=False,
        export_lights=False,
        export_cameras=False,
        export_materials=True,
        export_uvmaps=True,
        rename_uvmaps=True,
        export_normals=True,
        export_mesh_colors=False,
        generate_preview_surface=True,
        export_textures_mode="NEW",
        overwrite_textures=True,
        relative_paths=True,
        triangulate_meshes=True,
        usdz_downscale_size="512",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--texture")
    parser.add_argument("--material-mode", choices=["sharedWood", "original"], default="sharedWood")
    parser.add_argument("--ar-texture-brightness", type=float, default=AR_TEXTURE_BRIGHTNESS)
    parser.add_argument("--ar-texture-lift", type=float, default=AR_TEXTURE_LIFT)
    parser.add_argument("--catalog")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    if args.catalog:
        export_catalog(Path(args.catalog).resolve())
        return

    if not args.input or not args.output:
        parser.error("--input and --output are required without --catalog")

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    texture_path = Path(args.texture).resolve() if args.texture else DEFAULT_TEXTURE_PATH.resolve()

    export_model(
        input_path,
        output_path,
        texture_path,
        args.material_mode,
        args.ar_texture_brightness,
        args.ar_texture_lift,
    )


def export_catalog(catalog_path):
    public_root = catalog_path.parent
    catalog = json.loads(catalog_path.read_text())

    for model in catalog.get("models", []):
        model_url = model.get("modelUrl")
        usdz_url = model.get("usdzUrl")

        if not model_url or not usdz_url:
            print("Skipping incomplete model entry:", model)
            continue

        texture_url = model.get("textureUrl") or str(DEFAULT_TEXTURE_PATH)
        material_mode = model.get("materialMode") or "sharedWood"
        ar_texture_brightness = float(model.get("arTextureBrightness", AR_TEXTURE_BRIGHTNESS))
        ar_texture_lift = float(model.get("arTextureLift", AR_TEXTURE_LIFT))
        input_path = (public_root / model_url.lstrip("/")).resolve()
        output_path = (public_root / usdz_url.lstrip("/")).resolve()
        texture_path = (public_root / texture_url.lstrip("/")).resolve()

        print(f"\nExporting {model.get('id', input_path.stem)} ({material_mode})")
        export_model(
            input_path,
            output_path,
            texture_path,
            material_mode,
            ar_texture_brightness,
            ar_texture_lift,
        )


def export_model(input_path, output_path, texture_path, material_mode, ar_texture_brightness, ar_texture_lift):
    if material_mode not in {"sharedWood", "original"}:
        raise ValueError(f"Unsupported material mode: {material_mode}")

    glb_json = read_glb_json(input_path)
    allowed_names = default_scene_mesh_node_names(glb_json)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(input_path))

    objects = keep_default_scene_objects(allowed_names)
    if not objects:
        raise RuntimeError(f"No mesh object found in {input_path}")

    center_on_ground(objects)

    if material_mode == "sharedWood":
        ar_texture_path = create_ar_texture(texture_path, ar_texture_brightness, ar_texture_lift)
        wood_material = create_wood_material(ar_texture_path)
        make_single_material(objects, wood_material)
        assign_box_uvs(objects)

    apply_transforms(objects)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    export_usdz(output_path)

    min_corner, max_corner = world_bounds(objects)
    size = max_corner - min_corner
    print(
        "Exported",
        output_path,
        f"({material_mode})",
        "size meters:",
        f"{size.x:.3f} x {size.y:.3f} x {size.z:.3f}",
        "ar texture:",
        f"brightness={ar_texture_brightness:.3f}",
        f"lift={ar_texture_lift:.3f}",
    )


if __name__ == "__main__":
    main()

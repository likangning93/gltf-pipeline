'use strict';
var Cesium = require('cesium');
var baryCentricCoordinates = Cesium.barycentricCoordinates;
var Cartesian2 = Cesium.Cartesian2;
var Cartesian3 = Cesium.Cartesian3;
var CesiumMath = Cesium.Math;
var defaultValue = Cesium.defaultValue;
var defined = Cesium.defined;
var DeveloperError = Cesium.DeveloperError;
var Matrix3 = Cesium.Matrix3;
var Matrix4 = Cesium.Matrix4;
var Quaternion = Cesium.Quaternion;
var Ray = Cesium.Ray;
var ShaderSource = Cesium.ShaderSource;
var WebGLConstants = Cesium.WebGLConstants;

var buildTriangleStaticUniformGrid = require('./buildTriangleStaticUniformGrid');
var byteLengthForComponentType = require('./byteLengthForComponentType');
var clone = require('clone');
var Jimp = require('jimp');
var NodeHelpers = require('./NodeHelpers');
var readAccessor = require('./readAccessor');
var StaticUniformGrid = require('./StaticUniformGrid');
var GeometryMath = require('./GeometryMath');

module.exports = {
    bakeAmbientOcclusion: bakeAmbientOcclusion,
    generateOptions: generateOptions,
    generateRaytracerScene: generateRaytracerScene,
    computeAmbientOcclusionAt: computeAmbientOcclusionAt,
    raytraceAtTriangleCenters: raytraceAtTriangleCenters,
    raytraceOverTriangleSamples: raytraceOverTriangleSamples
};

var scratchRay = new Ray();
var barycentricCoordinateScratch = new Cartesian3();
var worldPositionScratch = new Cartesian3();
var worldNormalScratch = new Cartesian3();
var cartesian2Scratch = new Cartesian2();
var quaternionScratch = new Quaternion();
var matrix3Scratch = new Matrix3();
var matrix4Scratch = new Matrix4();

// AO options
// Basic:
// - toTexture: Bake AO to existing diffuse textures instead of to vertices. Does not modify shaders. Default: false
// - groundPlane: Add a groundplane at the lowest point of the model for AO computation. Default: false
// - ambientShadowContribution: amount of AO to show when blending between shader computed lighting and AO. 1.0 is full AO, 0.5 is a 50/50 blend. Default: 0.5
// - quality: Valid settings are high, medium, and low. Default: low

// Advanced quality settings:
// - density: for vertex baking mode, sample count per unit length at which to generate additional sample points. Default: 4.0, 2.0, 1.0
// - resolution: for texture baking mode, resolution at which to generate an AO texture. AO texture will be scaled to diffuse texture. Default: 512, 256, 128.
// - numberRays: number of rays to cast from each sample point. Clamps to nearest smaller square. Default: 64, 36, 16
// - triangleCenterOnly: for vertex baking mode, do not sample a triangle's area in addition to its center using a grid. Default: false

// Advanced appearance settings:
// - rayDistance: ray bottom-out distance in world-space units. Default: 1.0
// - nearCull: near cull depth for ray-triangle collisions. Default: 0.0001 units in world space.
// - shaderMode: how should the shader use per-vertex AO? Valid settings are multiply, replace, and blend. Default: blend
// - scene: which scene to use when baking AO. Default: gltf default

var useUniformGrid = true;

function bakeAmbientOcclusion(gltf, aoOptions) {
   var options = generateOptions(gltf, aoOptions);

    ////// Generate triangle soup //////
    // Requires each mesh to occur only once in the scene
    var scene = gltf.scenes[options.sceneID];
    var raytracerScene = generateRaytracerScene(gltf, scene, options);

    // Bin all the triangles into a uniform grid
    if (useUniformGrid) {
        raytracerScene.triangleSoup = buildTriangleStaticUniformGrid(raytracerScene.triangleSoup, options.rayDistance);
    }

    ////// Raytrace for each primitive and add to the gltf //////
    var parameters = {
        raytracerScene: raytracerScene,
        resolution: options.resolution,
        density: options.density
    };

    if (options.toTexture) {
        NodeHelpers.forEachPrimitiveInScene(gltf, scene, raytraceToTexels, parameters);
        bakeToTexture(gltf, scene, options.resolution, raytracerScene);
    } else {
        NodeHelpers.forEachPrimitiveInScene(gltf, scene, raytraceAtTriangleCenters, parameters);
        if (!options.triangleCenterOnly) {
            NodeHelpers.forEachPrimitiveInScene(gltf, scene, raytraceOverTriangleSamples, parameters);
        }
        bakeToVertices(gltf, scene, raytracerScene, options);
    }
}

function generateOptions(gltf, aoOptions) {
    var options = {
        toTexture: false,
        groundPlane: false,
        ambientShadowContribution: 0.5,
        density: 1.0,
        resolution: 128,
        numberRays: 16,
        triangleCenterOnly: false,
        rayDistance : 1.0,
        nearCull : 0.0001,
        shaderMode : 'blend',
        sceneID : gltf.scene
    };

    if (defined(aoOptions)) {
        options.toTexture = defaultValue(aoOptions.toTexture, options.toTexture);
        options.groundPlane = defaultValue(aoOptions.groundPlane, options.groundPlane);
        options.ambientShadowContribution = defaultValue(aoOptions.ambientShadowContribution, options.ambientShadowContribution);
        var quality = aoOptions.quality;

        // Change quality settings to match requested base quality, if not medium
        if (quality === 'high') {
            options.density = 4.0;
            options.resolution = 512;
            options.numberRays = 64;
        } else if (quality === 'medium') {
            options.density = 2.0;
            options.resolution = 256;
            options.numberRays = 36;
        }
        options.density = defaultValue(aoOptions.density, options.density);
        options.resolution = defaultValue(aoOptions.resolution, options.resolution);
        options.numberRays = defaultValue(aoOptions.numberRays, options.numberRays);
        options.triangleCenterOnly = defaultValue(aoOptions.triangleCenterOnly, options.triangleCenterOnly);

        options.rayDistance = defaultValue(aoOptions.rayDistance, options.rayDistance );
        options.nearCull = defaultValue(aoOptions.nearCull, options.nearCull);
        options.shaderMode = defaultValue(aoOptions.shaderMode, options.shaderMode);
        options.sceneID = defaultValue(aoOptions.scene, options.sceneID);
    }

    if (!defined(options.sceneID)) {
        throw new DeveloperError('In stage bakeAmbientOcclusion: No scene specified, and gltf has no default scene.');
    }
    return options;
}

////////// adding to the gltf by vertex //////////

// helper for bakeToVertices
function checkShadingChain(primitive, meshPrimitiveID, parameters) {
    if (parameters.aoBufferByPrimitive.hasOwnProperty(meshPrimitiveID)) {
        var materialID = primitive.material;
        var techniqueID = parameters.materials[materialID].technique;
        var programID = parameters.techniques[techniqueID].program;
        var program = parameters.programs[programID];
        var fragmentShaderID = program.fragmentShader;
        var vertexShaderID = program.vertexShader;

        parameters.materialCloneIDs[materialID] = '';
        parameters.techniqueCloneIDs[techniqueID] = '';
        parameters.programCloneIDs[programID] = '';
        parameters.vertexShaderCloneIDs[vertexShaderID] = '';
        parameters.fragmentShaderCloneIDs[fragmentShaderID] = '';
    }
}

function cloneJsonAsNeeded(id, cloneIds, items) {
    var cloneID = cloneIds[id];
    if (defined(cloneID)) {
        if (cloneID === '') { // No clone exists yet. Make one!
            cloneID = id + "_noAO";
            items[cloneID] = clone(items[id]);
            cloneIds[id] = cloneID;
        }
        return cloneID;
    }
    return id;
}

function cloneShadingChain(primitive, meshPrimitiveID, parameters) {
    // Only clone if a primitive that won't have AO still depends on these gltf items.
    if (!parameters.aoBufferByPrimitive.hasOwnProperty(meshPrimitiveID)) {
        var materials = parameters.materials;
        var techniques = parameters.techniques;
        var programs = parameters.programs;
        var shaders = parameters.shaders;

        // For each item in the shading chain, clone it if no clone exists.
        var materialID = primitive.material;
        primitive.material = cloneJsonAsNeeded(materialID, parameters.materialCloneIDs, materials);

        var material = materials[primitive.material];
        material.technique = cloneJsonAsNeeded(material.technique, parameters.techniqueCloneIDs, techniques);

        var technique = techniques[material.technique];
        technique.program = cloneJsonAsNeeded(technique.program, parameters.programCloneIDs, programs);

        var program = programs[technique.program];
        program.vertexShader = cloneJsonAsNeeded(program.vertexShader, parameters.vertexShaderCloneIDs, shaders);
        program.fragmentShader = cloneJsonAsNeeded(program.fragmentShader, parameters.fragmentShaderCloneIDs, shaders);
    }
}

function bakeToVertices(gltf, scene, raytracerScene, options) {

    // Add the new vertex data to the buffers along with bufferViews and accessors
    addVertexData(gltf, scene, raytracerScene);

    // Build lists of shaders, techniques, and primitives that need to be edited.
    // Basically, edit anything used by a primitive that has AO data lying around.
    // If anything is used by a primitive that doesn't have per-vertex AO, clone it first.
    var parameters = {
        aoBufferByPrimitive: raytracerScene.aoBufferByPrimitive,
        materials: gltf.materials,
        techniques: gltf.techniques,
        programs: gltf.programs,
        shaders: gltf.shaders,
        // Use the keys to keep track of what needs editing.
        // If an item gets cloned, store the clone's name as the value.
        materialCloneIDs: {},
        techniqueCloneIDs: {},
        programCloneIDs: {},
        vertexShaderCloneIDs: {},
        fragmentShaderCloneIDs: {}
    };

    NodeHelpers.forEachPrimitiveInScene(gltf, scene, checkShadingChain, parameters);

    // Clone materials, techniques, programs, and shaders as needed by primitives in other scenes.
    var sceneIDs = gltf.scenes;
    for (var otherSceneID in sceneIDs) {
        if (sceneIDs.hasOwnProperty(otherSceneID)) {
            var otherScene = sceneIDs[otherSceneID];
            NodeHelpers.forEachPrimitiveInScene(gltf, otherScene, cloneShadingChain, parameters);
        }
    }

    // Edit the shaders.
    // This can mean tracking down the unlit diffuse color input from the technique.
    addAoToShaders(gltf, Object.keys(parameters.techniqueCloneIDs), options);

    // Edit the programs: add the ao attribute
    var programCloneIds = parameters.programCloneIDs;
    for (var programID in programCloneIds) {
        if (programCloneIds.hasOwnProperty(programID)) {
            gltf.programs[programID].attributes.push('a_ambientOcclusion');
        }
    }

    var techniqueCloneIds = parameters.techniqueCloneIDs;
    // Edit the techniques: add ao to attributes, add ao to parameters
    for (var techniqueID in techniqueCloneIds) {
        if (techniqueCloneIds.hasOwnProperty(techniqueID)) {
            var technique = gltf.techniques[techniqueID];
            technique.attributes.a_ambientOcclusion = 'vertex_ao';
            technique.parameters.vertex_ao = {
                semantic: '_OCCLUSION',
                type: WebGLConstants.FLOAT
            };
        }
    }
}

// Helper for addVertexData
function concatenateAoBuffers(primitive, meshPrimitiveID, parameters) {
    if (parameters.aoBufferByPrimitive.hasOwnProperty(meshPrimitiveID)) {
        var aoBuffer = parameters.aoBufferByPrimitive[meshPrimitiveID];
        var vertexCount = aoBuffer.samples.length;
        var samples = aoBuffer.samples;
        var counts = aoBuffer.count;
        for (var i = 0; i < vertexCount; i++) {
            samples[i] = 1.0 - (samples[i]/counts[i]);
        }
        parameters.allAOData = parameters.allAOData.concat(samples);
        parameters.primitiveOrder.push(primitive);
        parameters.primitiveNames.push(meshPrimitiveID);
        parameters.primitiveVertexCounts.push(vertexCount);
    }
}

function addVertexData(gltf, scene, raytracerScene) {
    // Get all the ao vertex data together, ordered parallel with the vertex data
    // - append all the aoBuffers from the primitives
    // - record the order for the accessors
    var parameters = {
        aoBufferByPrimitive: raytracerScene.aoBufferByPrimitive,
        primitiveOrder: [],
        primitiveNames: [],
        primitiveVertexCounts: [],
        allAOData: []
    };

    NodeHelpers.forEachPrimitiveInScene(gltf, scene, concatenateAoBuffers, parameters);

    var primitiveOrder = parameters.primitiveOrder;
    var allAOData = parameters.allAOData;
    var allAODataLength = allAOData.length;

    gltf.buffers.aoBuffer = {
        input: {
            byteLength : allAODataLength * byteLengthForComponentType(WebGLConstants.FLOAT),
            type: 'arrayBuffer',
            uri: 'data:'
        },
        extras: {
            _pipeline: {
                source: new Buffer(new Float32Array(allAOData).buffer)
            }
        }
    };

    // add buffer view
    gltf.bufferViews.aoBufferView = {
        buffer: 'aoBuffer',
        byteOffset: 0,
        byteLength: allAODataLength * 4,
        target: WebGLConstants.ARRAY_BUFFER
    };

    // add accessor for each primitive
    var primitiveCount = primitiveOrder.length;
    var byteOffset = 0;
    for (var i = 0; i < primitiveCount; i++) {
        var primitive = primitiveOrder[i];
        var primitiveVertexCount = parameters.primitiveVertexCounts[i];
        var name = 'accessor_' + parameters.primitiveNames[i] + '_AO';
        primitive.attributes._OCCLUSION = name;
        gltf.accessors[name] = {
            bufferView: 'aoBufferView',
            byteOffset: byteOffset,
            componentType: WebGLConstants.FLOAT,
            count: primitiveVertexCount,
            type: 'SCALAR'
        };
        byteOffset += primitiveVertexCount * 4;
    }
}

function addAoToShaders(gltf, techniquesIDsToLookAt, options) {
    // Keep track of which shaders have been edited
    var shaders = gltf.shaders;
    var shadersEdited = {};
    for (var shaderID in shaders) {
        if (shaders.hasOwnProperty(shaderID)) {
            shadersEdited[shaderID] = false;
        }
    }

    // For each technique,
    var techniquesCount = techniquesIDsToLookAt.length;
    for (var i = 0; i < techniquesCount; i++) {
        var technique = gltf.techniques[techniquesIDsToLookAt[i]];

        var glslNewAttributes = 'attribute float a_ambientOcclusion; \n'; // snippet for adding attributes
        var glslNewVaryings = 'varying float v_ambientOcclusion; \n'; // snippet for adding varying
        var glslPassThrough = 'v_ambientOcclusion = a_ambientOcclusion; \n'; // snippet for passing values from vs to fs
        var glslChangeColor; // snippet for editing the final glsl color
        var glslDiffuseColor; // snippet for accessing the diffuse color

        if (options.shaderMode !== 'multiply') {
            // Check for a diffuse uniform and note if it's a texture or a term
            var diffuseParameter = technique.parameters.diffuse;
            if (!defined(diffuseParameter)) {
                throw new DeveloperError('In stage bakeAmbientOcclusion: Could not find parameter diffuse in technique ' + techniquesIDsToLookAt[i]);
            }

            var uniforms = technique.uniforms;
            // fetch the uniform name for the diffuse uniform
            for (var uniformName in uniforms) {
                if (uniforms.hasOwnProperty(uniformName)) {
                    if (uniforms[uniformName] === 'diffuse') {
                        glslDiffuseColor = uniformName;
                        break;
                    }
                }
            }
            if (diffuseParameter.type === WebGLConstants.SAMPLER_2D) {
                glslNewVaryings += 'varying vec2 v_ambientOcclusionUV; \n';
                // fetch the UV attribute name so we can pass it through
                var attributes = technique.attributes;
                var passUVThrough;
                for (var attributeName in attributes) {
                    if (attributes.hasOwnProperty(attributeName)) {
                        if (attributes[attributeName] === 'texcoord0') {
                            passUVThrough = 'v_ambientOcclusionUV = ' + attributeName + ';\n';
                            break;
                        }
                    }
                }
                if (!defined(passUVThrough)) {
                    throw new DeveloperError('In stage bakeAmbientOcclusion: Could not find attribute a_texcoord0 in technique ' + techniquesIDsToLookAt[i]);
                }
                glslPassThrough += passUVThrough;
                glslDiffuseColor = 'texture2D(' + glslDiffuseColor + ', v_ambientOcclusionUV)';
            }
            glslDiffuseColor += '.rgb';
        }

        switch(options.shaderMode) {
            case 'multiply':
                glslChangeColor = 'gl_FragColor.rgb *= v_ambientOcclusion; \n';
                break;
            case 'replace':
                glslChangeColor = 'gl_FragColor.rgb = v_ambientOcclusion * ' + glslDiffuseColor + '; \n';
                break;
            default: // mix
                glslChangeColor = 'gl_FragColor.rgb = mix(gl_FragColor.rgb, v_ambientOcclusion * ' +
                    glslDiffuseColor + ', ' + (options.ambientShadowContribution + 0.0) + '); \n';
                break;
        }

        // Replace the shaders in the gltf
        var program = gltf.programs[technique.program];
        if (!shadersEdited[program.vertexShader]) {
            shadersEdited[program.vertexShader] = true;
            editShader(shaders[program.vertexShader], glslNewAttributes + glslNewVaryings, 'mainBeforeAO', glslPassThrough);
        }
        if (!shadersEdited[program.fragmentShader]) {
            shadersEdited[program.fragmentShader] = true;
            editShader(shaders[program.fragmentShader], glslNewVaryings, 'mainBeforeAO', glslChangeColor);
        }
    }
}

function editShader(shader, newVaryingsAttributes, mainNewName, commandsForNewMain) {
    var sourceString = shader.extras._pipeline.source.toString();
    // Wrap main
    sourceString = ShaderSource.replaceMain(sourceString, mainNewName);
    var newSourceString = '';

    newSourceString += sourceString;
    newSourceString += newVaryingsAttributes;
    newSourceString += '\n' +
        'void main() \n' +
        '{ \n' +
        '    ' + mainNewName + '(); \n';
    newSourceString += '    ' + commandsForNewMain;
    newSourceString +='}';

    // Repack into source
    shader.extras._pipeline.source = new Buffer(newSourceString);
}

////////// adding to the gltf by texture //////////

function bakeToTexture(gltf, scene, resolution, raytracerScene) {
    // find material with a diffuse texture parameter to clone as needed
    var materials = gltf.materials;
    var textures = gltf.textures;

    var exampleMaterialID;
    var exampleTextureID;
    var exampleImageID;

    for (var materialID in materials) {
        if (materials.hasOwnProperty(materialID)) {
            var material = materials[materialID];
            if (defined(material.values) && defined(material.values.diffuse)) {
                if (typeof material.values.diffuse === 'string') {
                    exampleMaterialID = materialID;
                    exampleTextureID = material.values.diffuse;
                    exampleImageID = textures[exampleTextureID].source;
                    break;
                }
            }
        }
    }

    if (!defined(exampleMaterialID)) {
        throw new DeveloperError('In stage bakeAmbientOcclusion: could not find any materials with a diffuse texture.');
    }

    // Build a hash of materials, textures, and images we've seen so far to ensure uniqueness
    var parameters = {
        materialsSeen: {},
        texturesSeen: {},
        imagesSeen: {},
        exampleMaterialID: exampleMaterialID,
        exampleTextureID: exampleTextureID,
        exampleImageID: exampleImageID,
        resolution: resolution,
        gltf: gltf,
        raytracerScene: raytracerScene
    };

    // Bake AO for each primitive in the scene
    NodeHelpers.forEachPrimitiveInScene(gltf, scene, addAoToImage, parameters);
}

function addAoToImage(primitive, meshPrimitiveID, parameters) {
    // Enforce material/texture/image uniqueness
    var gltf = parameters.gltf;
    var diffuseImage = ensureImageUniqueness(gltf, primitive, meshPrimitiveID, parameters);
    diffuseImage.extras._pipeline.imageChanged = true;
    var diffuseImageJimp = diffuseImage.extras._pipeline.jimpImage;
    var goalResolution = diffuseImageJimp.bitmap.width;

    // Post process the AO
    var jimpAO = gltf.extras._pipeline.jimpScratch;
    var aoBuffer = parameters.raytracerScene.aoBufferByPrimitive[meshPrimitiveID];
    postProcessAO(aoBuffer, parameters.resolution, goalResolution, jimpAO);

    // Modify the diffuse image with AO
    for (var x = 0; x < goalResolution; x++) {
        for (var y = 0; y < goalResolution; y++) {
            var idx = (goalResolution * y + x) * 4;
            var aoValue = 1.0 - (jimpAO.bitmap.data[idx + 3] / 255.0);

            // darken each channel by the ao value
            diffuseImageJimp.bitmap.data[idx] *= aoValue;
            diffuseImageJimp.bitmap.data[idx + 1] *= aoValue;
            diffuseImageJimp.bitmap.data[idx + 2] *= aoValue;
        }
    }
}

function postProcessAO(aoBuffer, dataResolution, goalResolution, jimpAO) {
    // Copy the data over to the jimp
    jimpAO.resize(dataResolution, dataResolution);
    for (var x = 0; x < dataResolution; x++) {
        for (var y = 0; y < dataResolution; y++) {
            var dataIdx = dataResolution * y + x;
            var sampleCount = aoBuffer.count[dataIdx];
            var value = 0.0;
            value = 255.0 * (aoBuffer.samples[dataIdx] / sampleCount);
            jimpAO.bitmap.data[dataIdx * 4 + 3] = value;
        }
    }
    // Resize the data to match the goal resolution
    jimpAO.resize(goalResolution, goalResolution, Jimp.RESIZE_BEZIER);
}

function cloneAndSetupMaterialTextureImage(newMateralID, newTextureID, newImageID,
                      oldMateralID, oldTextureID, oldImageID,
                      materials, textures, images) {
    var newImage;
    var newTexture;
    var newMaterial;

    if (defined(newImageID)) {
        var oldImage = images[oldImageID];
        newImage = clone(oldImage);
        newImage.extras._pipeline.jimpImage = oldImage.extras._pipeline.jimpImage.clone();
        images[newImageID] = newImage;
    }
    if (defined(newTextureID)) {
        var oldTexture = textures[oldTextureID];
        newTexture = clone(oldTexture);
        newTexture.source = newImageID;
        textures[newTextureID] = newTexture;
        if (defined(newMateralID)) {
            newMaterial = clone(materials[oldMateralID]);
            newMaterial.texture = newTextureID;
            materials[newMateralID] = newMaterial;
        }
    }
}

// Check and modify the given material to ensure every primitive gets a unique material, texture, and image
function ensureImageUniqueness(gltf, primitive, meshPrimitiveID, state) {
    var materialsSeen = state.materialsSeen;
    var texturesSeen = state.texturesSeen;
    var imagesSeen = state.imagesSeen;

    var allMaterials = gltf.materials;
    var allTextures = gltf.textures;
    var allImages = gltf.images;

    // Generate some new IDs
    var newMaterialID = meshPrimitiveID + '_AO_material';
    var newTextureID = meshPrimitiveID + '_AO_texture';
    var newImageID = meshPrimitiveID + '_AO_image';

    // Grab the existing material
    var materialID = primitive.material;
    var material = allMaterials[materialID];
    var values = material.values;
    var diffuse = values.diffuse;

    // Check if the material has a diffuse texture material. if not,
    // - clone the example material
    // - clone the example texture
    // - clone the example image. resize to resolution and set to diffuse color, if any
    if (!defined(diffuse) || typeof diffuse !== 'string') {
        cloneAndSetupMaterialTextureImage(
            newMaterialID, newTextureID, newImageID,
            state.exampleMaterialID, state.exampleTextureID, state.exampleImageID,
            allMaterials, allTextures, allImages);

        var color = defaultValue(diffuse, [1.0, 1.0, 1.0, 1.0]);
        // For jimp
        color[0] *= 255;
        color[1] *= 255;
        color[2] *= 255;
        color[3] *= 255;

        var newJimpImage = allImages[newImageID].extras._pipeline.jimpImage;

        var resolution = state.resolution;
        newJimpImage.resize(resolution, resolution);
        var hexColor = Jimp.rgbaToInt(color[0], color[1], color[2], color[3]);
        for (var x = 0; x < resolution; x++) {
            for (var y = 0; y < resolution; y++) {
                newJimpImage.setPixelColor(x, y, hexColor);
            }
        }
        primitive.material = newMaterialID;
        return allImages[newImageID];
    }

    var textureID = diffuse;
    var imageID = allTextures[textureID].source;

    if (materialsSeen.hasOwnProperty(materialID)) {
        // Check if the material is unique. If not, clone material, texture, and image
        cloneAndSetupMaterialTextureImage(
            newMaterialID, newTextureID, newImageID,
            materialID, textureID, imageID,
            allMaterials, allTextures, allImages);
        primitive.material = newMaterialID;
    } else if(texturesSeen.hasOwnProperty(textureID)) {
        // Check if the texture is unique. If not clone the texture and the image.
        cloneAndSetupMaterialTextureImage(
            undefined, newTextureID, newImageID,
            materialID, textureID, imageID,
            allMaterials, allTextures, allImages);
        values.diffuse = newTextureID;
    } else if(imagesSeen.hasOwnProperty(imageID)) {
        // Check if the image is unique. if not, clone the image.
        var texture = allTextures[textureID];
        cloneAndSetupMaterialTextureImage(
            undefined, undefined, newImageID,
            materialID, textureID, imageID,
            allMaterials, allTextures, allImages);
        texture.source = newImageID;
    } else {
        // If nothing was cloned, mark this material, texture, and image as seen
        materialsSeen[materialID] = true;
        texturesSeen[textureID] = true;
        imagesSeen[imageID] = true;
        newImageID = imageID;
    }
    return allImages[newImageID];
}

////////// loading //////////

function generateRaytracerScene(gltf, scene, options) {
    // Set up data we need for sampling. generate "triangle soup" over the whole scene.
    var accessors = gltf.accessors;

    // read all accessors in one go to avoid repeated read-and-conversion
    var bufferDataByAccessor = {};

    for (var accessorID in accessors) {
        if (accessors.hasOwnProperty(accessorID)) {
            var accessor = accessors[accessorID];
            bufferDataByAccessor[accessorID] = readAccessor(gltf, accessor);
        }
    }

    var raytracerScene = {
        bufferDataByAccessor: bufferDataByAccessor,
        numberRays: options.numberRays,
        rayDistance: options.rayDistance,
        triangleSoup: [],
        aoBufferByPrimitive: {},
        nearCull: options.nearCull,
        toTexture: options.toTexture,
        sceneMin: new Cartesian3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
        sceneMax: new Cartesian3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
    };

    // TODO: currently assuming each primitive appears in the scene once. figure out what to do when this is not true.

    // Generate all the world transform matrices
    NodeHelpers.computeFlatTransformScene(scene, gltf.nodes);

    var parameters = {
        resolution: options.resolution,
        raytracerScene: raytracerScene
    };

    // Process each primitive
    NodeHelpers.forEachPrimitiveInScene(gltf, scene, processPrimitive, parameters);

    if (options.groundPlane) {
        // Generate a ground plane as two massive triangles if requested
        // - should be big enough that no rays can "overshoot" it
        // - should be a little lower than scene min + nearCull so rays cast from points at min can still hit it.
        var min = raytracerScene.sceneMin;
        var max = raytracerScene.sceneMax;
        var rayPadWidth = raytracerScene.rayDistance * 2.0;
        var planeHeight = min.y - 1.5 * raytracerScene.nearCull;
        var minmin = new Cartesian3(min.x - rayPadWidth, planeHeight, min.z - rayPadWidth);
        var maxmin = new Cartesian3(max.x + rayPadWidth, planeHeight, min.z - rayPadWidth);
        var maxmax = new Cartesian3(max.x + rayPadWidth, planeHeight, max.z + rayPadWidth);
        var minmax = new Cartesian3(min.x - rayPadWidth, planeHeight, max.z + rayPadWidth);

        raytracerScene.triangleSoup.push([minmin, maxmin, maxmax]);
        raytracerScene.triangleSoup.push([minmin, maxmax, minmax]);
    }

    return raytracerScene;
}

function processPrimitive(primitive, meshPrimitiveID, parameters, node) {
    // AO only works with triangles, which is default if no mode specified
    if (defined(primitive.mode) && primitive.mode !== WebGLConstants.TRIANGLES) {
        return;
    }

    var raytracerScene = parameters.raytracerScene;
    var bufferDataByAccessor = raytracerScene.bufferDataByAccessor;
    var indices = bufferDataByAccessor[primitive.indices].data;
    var positions = bufferDataByAccessor[primitive.attributes.POSITION].data;
    var numberTriangles = indices.length / 3;
    var transform = node.extras._pipeline.flatTransform;

    var resolution = parameters.resolution;

    if (raytracerScene.toTexture) {
        if (!defined(primitive.attributes.TEXCOORD_0)) {
            throw new DeveloperError("In stage bakeAmbientOcclusion: could not find TEXCOORD_0. Generate texture coordinates or bake to vertices instead.");
        }
        raytracerScene.aoBufferByPrimitive[meshPrimitiveID] = {
            resolution: resolution,
            samples: new Array(resolution * resolution).fill(0.0),
            count: new Array(resolution * resolution).fill(CesiumMath.EPSILON10) // avoid div0 without branching
        };
    } else {
        var vertexCount = positions.length;
        raytracerScene.aoBufferByPrimitive[meshPrimitiveID] = {
            samples: new Array(vertexCount).fill(0.0),
            count: new Array(vertexCount).fill(CesiumMath.EPSILON10) // avoid div0 without branching
        };
    }

    // Read each triangle's Cartesian3s using the index buffer
    for (var i = 0; i < numberTriangles; i++) {
        var index0 = indices[i * 3];
        var index1 = indices[i * 3 + 1];
        var index2 = indices[i * 3 + 2];

        // Generate a world space triangle geometry for the soup
        var position0 = Matrix4.multiplyByPoint(transform, positions[index0], new Cartesian3());
        var position1 = Matrix4.multiplyByPoint(transform, positions[index1], new Cartesian3());
        var position2 = Matrix4.multiplyByPoint(transform, positions[index2], new Cartesian3());

        var triangle = [position0, position1, position2];
        raytracerScene.triangleSoup.push(triangle);
        raytracerScene.sceneMin.x = Math.min(position0.x, position1.x, position2.x, raytracerScene.sceneMin.x);
        raytracerScene.sceneMin.y = Math.min(position0.y, position1.y, position2.y, raytracerScene.sceneMin.y);
        raytracerScene.sceneMin.z = Math.min(position0.z, position1.z, position2.z, raytracerScene.sceneMin.z);
        raytracerScene.sceneMax.x = Math.max(position0.x, position1.x, position2.x, raytracerScene.sceneMax.x);
        raytracerScene.sceneMax.y = Math.max(position0.y, position1.y, position2.y, raytracerScene.sceneMax.y);
        raytracerScene.sceneMax.z = Math.max(position0.z, position1.z, position2.z, raytracerScene.sceneMax.z);
    }
}

////////// Rendering //////////

// Callback should expect arguments as parameters, contribution, count, pixelIndex
function trianglePixelMarch(uv0, uv1, uv2, position0, position1, position2, normal0, normal1, normal2,
                    transform, inverseTranspose,
                    raytracerScene, pixelWidth, resolution, callback, parameters) {
    var uMin = Math.min(uv0.x, uv1.x, uv2.x);
    var vMin = Math.min(uv0.y, uv1.y, uv2.y);
    var uMax = Math.max(uv0.x, uv1.x, uv2.x);
    var vMax = Math.max(uv0.y, uv1.y, uv2.y);

    // Perform a pixel march over the
    // 0.0, 0.0 to width, width is the bottom left pixel
    // 1.0-width, 1.0-width to 1.0, 1.0 is the top right pixel
    // TODO: borrow from conservative rasterization: http://http.developer.nvidia.com/GPUGems2/gpugems2_chapter42.html
    var halfWidth = pixelWidth / 2.0;
    uMin = Math.floor(uMin / pixelWidth) * pixelWidth + halfWidth;
    vMin = Math.floor(vMin / pixelWidth) * pixelWidth + halfWidth;
    uMax = Math.floor(uMax / pixelWidth) * pixelWidth + halfWidth;
    vMax = Math.floor(vMax / pixelWidth) * pixelWidth + halfWidth;

    var barycentric = barycentricCoordinateScratch;

    var numberRays = raytracerScene.numberRays;
    var sqrtnumberRays = Math.floor(Math.sqrt(numberRays));
    numberRays = sqrtnumberRays * sqrtnumberRays;
    
    var uStep = uMin;
    while(uStep < uMax) {
        var vStep = vMin;
        while(vStep < vMax) {
            // Use the triangle's uv coordinates to compute this texel's barycentric coordinates on the triangle
            cartesian2Scratch.x = uStep;
            cartesian2Scratch.y = vStep;
            barycentric = baryCentricCoordinates(cartesian2Scratch, uv0, uv1, uv2, barycentric);

            // Not in triangle
            if (barycentric.x < 0.0 || barycentric.y < 0.0 || barycentric.z < 0.0) {
                vStep += pixelWidth;
                continue;
            }

            // Use this barycentric coordinate to compute the local space position and normal on the triangle
            var position = worldPositionScratch;
            var normal = worldNormalScratch;
            GeometryMath.sumBarycentric(barycentric, position0, position1, position2, position);
            GeometryMath.sumBarycentric(barycentric, normal0, normal1, normal2, normal);

            // Transform to world space
            Matrix4.multiplyByPoint(transform, position, position);
            Matrix4.multiplyByPointAsVector(inverseTranspose, normal, normal);
            Cartesian3.normalize(normal, normal);

            // Raytrace
            var contribution = computeAmbientOcclusionAt(
                position, normal, numberRays, sqrtnumberRays,
                raytracerScene.triangleSoup, raytracerScene.nearCull, raytracerScene.rayDistance);

            callback(parameters, contribution, numberRays, Math.floor(uStep / pixelWidth) + Math.floor(vStep / pixelWidth) * resolution);
            vStep += pixelWidth;
        }
        uStep += pixelWidth;
    }
}

function texelCallback(aoBuffer, contribution, numberRays, pixelIndex) {
    aoBuffer.count[pixelIndex] += numberRays;
    aoBuffer.samples[pixelIndex] += contribution;
}

function raytraceToTexels(primitive, meshPrimitiveID, parameters, node) {
    var raytracerScene = parameters.raytracerScene;
    var aoBuffer = raytracerScene.aoBufferByPrimitive[meshPrimitiveID];
    // If this primitive has no aoBuffer, skip. It's possible that this primitive is not triangles.
    if (!defined(aoBuffer)) {
        return;
    }

    var bufferDataByAccessor = raytracerScene.bufferDataByAccessor;
    var indices = bufferDataByAccessor[primitive.indices].data;
    var positions = bufferDataByAccessor[primitive.attributes.POSITION].data;
    var normals = bufferDataByAccessor[primitive.attributes.NORMAL].data;
    var uvs = bufferDataByAccessor[primitive.attributes.TEXCOORD_0].data;
    var numTriangles = indices.length / 3;
    var transform = node.extras._pipeline.flatTransform;
    var inverseTranspose = matrix4Scratch;
    inverseTranspose = Matrix4.transpose(transform, inverseTranspose);
    inverseTranspose = Matrix4.inverse(inverseTranspose, inverseTranspose);

    var resolution = parameters.resolution;
    var pixelWidth = 1.0 / resolution;

    // For each position on a triangle corresponding to a texel center,
    // raytrace ambient occlusion.
    var part = numTriangles / 100.0;
    var hundredth = part;
    console.log(meshPrimitiveID + " " + numTriangles)

    for (var i = 0; i < numTriangles; i++) {
        if (i < part) {
            part += hundredth;
            console.log(i / numTriangles);
        }

        var i0 = indices[i * 3];
        var i1 = indices[i * 3 + 1];
        var i2 = indices[i * 3 + 2];

        trianglePixelMarch(uvs[i0], uvs[i1], uvs[i2], positions[i0], positions[i1], positions[i2],
        normals[i0], normals[i1], normals[i2], transform, inverseTranspose,
            raytracerScene, pixelWidth, resolution,
            texelCallback, aoBuffer);
    }
}

// Sample AO at each triangle center and add the resulting contribution to each vertex.
// Can be used on its own for high resolution meshes OR as a baseline for raytraceOverTriangleSamples
function raytraceAtTriangleCenters(primitive, meshPrimitiveID, parameters, node) {
    var raytracerScene = parameters.raytracerScene;
    var aoBuffer = raytracerScene.aoBufferByPrimitive[meshPrimitiveID];

    // If this primitive has no aoBuffer, skip. It's possible that this primitive is not triangles.
    if (!defined(aoBuffer)) {
        return;
    }

    var bufferDataByAccessor = raytracerScene.bufferDataByAccessor;
    var indices = bufferDataByAccessor[primitive.indices].data;
    var positions = bufferDataByAccessor[primitive.attributes.POSITION].data;
    var normals = bufferDataByAccessor[primitive.attributes.NORMAL].data;
    var numTriangles = indices.length / 3;

    var transform = node.extras._pipeline.flatTransform;
    var inverseTranspose = matrix4Scratch;
    inverseTranspose = Matrix4.transpose(transform, inverseTranspose);
    inverseTranspose = Matrix4.inverse(inverseTranspose, inverseTranspose);

    var triangleSoup = raytracerScene.triangleSoup;
    var numberRays = raytracerScene.numberRays;
    var sqrtNumberRays = Math.floor(Math.sqrt(numberRays));

    console.log("raytracing AO at " + numTriangles + " triangle centers.");
    var part = numTriangles / 10.0;
    var tenth = part;

    // From each triangle center, raytrace ambient occlusion.
    for (var i = 0; i < numTriangles; i++) {

        if (i > part) {
            part += tenth;
            console.log(i / numTriangles);
        }

        var index0 = indices[i * 3];
        var index1 = indices[i * 3 + 1];
        var index2 = indices[i * 3 + 2];

        var position = worldPositionScratch;
        var normal = worldNormalScratch;
        var barycentric = barycentricCoordinateScratch;
        barycentric.x = 1/3;
        barycentric.y = 1/3;
        barycentric.z = 1/3;

        GeometryMath.sumBarycentric(barycentric, positions[index0], positions[index1], positions[index2], position);
        GeometryMath.sumBarycentric(barycentric, normals[index0], normals[index1], normals[index2], normal);

        // Transform to world space
        Matrix4.multiplyByPoint(transform, position, position);
        Matrix4.multiplyByPointAsVector(inverseTranspose, normal, normal);
        Cartesian3.normalize(normal, normal);

        // Raytrace
        var contribution = computeAmbientOcclusionAt(position, normal, numberRays, sqrtNumberRays,
            triangleSoup, raytracerScene.nearCull,
            raytracerScene.rayDistance);

        aoBuffer.samples[index0] += contribution;
        aoBuffer.samples[index1] += contribution;
        aoBuffer.samples[index2] += contribution;
        aoBuffer.count[index0] += numberRays;
        aoBuffer.count[index1] += numberRays;
        aoBuffer.count[index2] += numberRays;
    }
}

var triangleUVs = [];
triangleUVs.push(new Cartesian2());
triangleUVs.push(new Cartesian2());
triangleUVs.push(new Cartesian2());

function raytraceOverTriangleSamples(primitive, meshPrimitiveID, parameters, node) {
    var raytracerScene = parameters.raytracerScene;
    var aoBuffer = raytracerScene.aoBufferByPrimitive[meshPrimitiveID];

    // If this primitive has no aoBuffer, skip. It's possible that this primitive is not triangles.
    if (!defined(aoBuffer)) {
        return;
    }

    var bufferDataByAccessor = raytracerScene.bufferDataByAccessor;
    var indices = bufferDataByAccessor[primitive.indices].data;
    var positions = bufferDataByAccessor[primitive.attributes.POSITION].data;
    var normals = bufferDataByAccessor[primitive.attributes.NORMAL].data;
    var numTriangles = indices.length / 3;
    var transform = node.extras._pipeline.flatTransform;
    var inverseTranspose = matrix4Scratch;
    inverseTranspose = Matrix4.transpose(transform, inverseTranspose);
    inverseTranspose = Matrix4.inverse(inverseTranspose, inverseTranspose);

    var resolution = parameters.density;
    var pixelWidth = 1.0 / resolution;



    // From each position on a triangle corresponding to a texel center,
    // raytrace ambient occlusion.
    console.log("raytracing AO over " + numTriangles + " triangles.");
    var part = numTriangles / 10.0;
    var tenth = part;

    // From each triangle center, raytrace ambient occlusion.
    for (var i = 0; i < numTriangles; i++) {

        if (i > part) {
            part += tenth;
            console.log(i / numTriangles);
        }

        var i0 = indices[i * 3];
        var i1 = indices[i * 3 + 1];
        var i2 = indices[i * 3 + 2];

        var position0 = positions[i0];
        var position1 = positions[i1];
        var position2 = positions[i2];

        // compute UVs for the triangle
        GeometryMath.flattenTriangle([position0, position1, position2], triangleUVs);

        var callbackParameters = {
            aoBuffer: aoBuffer,
            i0: i0,
            i1: i1,
            i2: i2
        };

        trianglePixelMarch(triangleUVs[0], triangleUVs[1], triangleUVs[2],
            positions[i0], positions[i1], positions[i2],
            normals[i0], normals[i1], normals[i2], transform, inverseTranspose,
            raytracerScene, pixelWidth, resolution,
            planeSampleCallback, callbackParameters);
    }
}

function planeSampleCallback(parameters, contribution, numberRays) {
    // Get each vertex's current AO as a baseline
    var aoBuffer = parameters.aoBuffer;
    var i0 = parameters.i0;
    var i1 = parameters.i1;
    var i2 = parameters.i2;

    // Update samples. Denormalize to prevent these samples from being overwhelmed by existing data.
    aoBuffer.samples[i0] += contribution;
    aoBuffer.samples[i1] += contribution;
    aoBuffer.samples[i2] += contribution;
    aoBuffer.count[i0] += numberRays;
    aoBuffer.count[i1] += numberRays;
    aoBuffer.count[i2] += numberRays;
}

function computeAmbientOcclusionAt(position, normal, numberRays, sqrtNumberRays,
    triangles, nearCull, rayDistance) {
    var contribution = 0.0;
    for (var j = 0; j < numberRays; j++) {
        var sampleRay = generateJitteredRay(position, normal, j, sqrtNumberRays);
        var nearestIntersect;
        if (useUniformGrid) {
            nearestIntersect = uniformGridRaytrace(triangles, sampleRay, nearCull, rayDistance);
        } else {
            nearestIntersect = naiveRaytrace(triangles, sampleRay, nearCull);
        }

        if (nearestIntersect < rayDistance) {
            contribution += 1.0;
        }
    }
    return contribution;
}

function naiveRaytrace(triangleSoup, ray, nearCull) {
    // Check ray against every triangle in the soup. return the nearest intersection.
    var minIntersect = Number.POSITIVE_INFINITY;
    var triangleCount = triangleSoup.length;
    for (var triangleSoupIndex = 0; triangleSoupIndex < triangleCount; triangleSoupIndex++) {
        var positions = triangleSoup[triangleSoupIndex];
        var distance = rayTriangle(ray, positions[0], positions[1], positions[2], false);
        if (defined(distance) && distance > nearCull) {
            minIntersect = Math.min(distance, minIntersect);
        }
    }
    return minIntersect;
}

function raytraceNeighborFunction(positions, parameters) {
    var distance = rayTriangle(parameters.ray, positions[0], positions[1], positions[2], false);
    parameters.intersect = distance;
    return (defined(distance) && distance > parameters.nearCull && distance < parameters.rayDistance);
}

var parametersScratch = {
    rayDistance: Number.POSITIVE_INFINITY,
    nearCull: 0.0001,
    intersect: 0.0,
    ray: new Ray()
};

function uniformGridRaytrace(uniformGrid, ray, nearCull, farCull) {
    var parameters = parametersScratch;
    parameters.ray = ray;
    parameters.nearCull = nearCull;
    parameters.rayDistance = farCull;
    parameters.intersect = Number.POSITIVE_INFINITY;
    StaticUniformGrid.forEachNeighbor(uniformGrid, ray.origin, raytraceNeighborFunction, parameters);
    return parameters.intersect;
}

var axisScratch = new Cartesian3();
function generateJitteredRay(position, normal, sampleNumber, sqrtNumberRays) {
    // Stratified (jittered) Sampling with javascript's own rand function
    // Based on notes here: http://graphics.ucsd.edu/courses/cse168_s14/ucsd/CSE168_11_Random.pdf

    // Produces samples based on a grid of dimension sqrtNumberRays x sqrtNumberRays
    var cellWidth = 1.0 / sqrtNumberRays;
    var s = (sampleNumber % sqrtNumberRays) * cellWidth + (Math.random() / sqrtNumberRays);
    var t = Math.floor(sampleNumber / sqrtNumberRays) * cellWidth + (Math.random() / sqrtNumberRays);

    // Generate ray on a y-up hemisphere with cosine weighting (more rays around the normal)
    var u = 2.0 * Math.PI * s;
    var v = Math.sqrt(1.0 - t);

    var randomDirection = scratchRay.direction;
    randomDirection.x = v * Math.cos(u);
    randomDirection.y = t;
    randomDirection.z = v * Math.sin(u);

    // Orient with given normal
    var theta = Math.acos(normal.y); // dot product of normal with y-up is normal.y
    var axis = Cartesian3.cross(randomDirection, normal, axisScratch);
    var rotation = Quaternion.fromAxisAngle(axis, theta, quaternionScratch);
    var matrix = Matrix3.fromQuaternion(rotation, matrix3Scratch);

    scratchRay.origin = position;
    scratchRay.direction = Matrix3.multiplyByVector(matrix, randomDirection, scratchRay.direction);
    return scratchRay;
}

// Borrowed straight from Cesium/Source/Core/IntersectionTests
var scratchEdge0 = new Cartesian3();
var scratchEdge1 = new Cartesian3();
var scratchPVec = new Cartesian3();
var scratchTVec = new Cartesian3();
var scratchQVec = new Cartesian3();

function rayTriangle(ray, p0, p1, p2, cullBackFaces) {
    //>>includeStart('debug', pragmas.debug);
    if (!defined(ray)) {
        throw new DeveloperError('ray is required.');
    }
    if (!defined(p0)) {
        throw new DeveloperError('p0 is required.');
    }
    if (!defined(p1)) {
        throw new DeveloperError('p1 is required.');
    }
    if (!defined(p2)) {
        throw new DeveloperError('p2 is required.');
    }
    //>>includeEnd('debug');

    cullBackFaces = defaultValue(cullBackFaces, false);

    var origin = ray.origin;
    var direction = ray.direction;

    var edge0 = Cartesian3.subtract(p1, p0, scratchEdge0);
    var edge1 = Cartesian3.subtract(p2, p0, scratchEdge1);

    var p = Cartesian3.cross(direction, edge1, scratchPVec);
    var det = Cartesian3.dot(edge0, p);

    var tvec;
    var q;

    var u;
    var v;
    var t;

    if (cullBackFaces) {
        if (det < CesiumMath.EPSILON6) {
            return undefined;
        }

        tvec = Cartesian3.subtract(origin, p0, scratchTVec);
        u = Cartesian3.dot(tvec, p);
        if (u < 0.0 || u > det) {
            return undefined;
        }

        q = Cartesian3.cross(tvec, edge0, scratchQVec);

        v = Cartesian3.dot(direction, q);
        if (v < 0.0 || u + v > det) {
            return undefined;
        }

        t = Cartesian3.dot(edge1, q) / det;
    } else {
        if (Math.abs(det) < CesiumMath.EPSILON6) {
            return undefined;
        }
        var invDet = 1.0 / det;

        tvec = Cartesian3.subtract(origin, p0, scratchTVec);
        u = Cartesian3.dot(tvec, p) * invDet;
        if (u < 0.0 || u > 1.0) {
            return undefined;
        }

        q = Cartesian3.cross(tvec, edge0, scratchQVec);

        v = Cartesian3.dot(direction, q) * invDet;
        if (v < 0.0 || u + v > 1.0) {
            return undefined;
        }

        t = Cartesian3.dot(edge1, q) * invDet;
    }

    return t;
}

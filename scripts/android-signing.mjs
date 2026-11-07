// Adds release signing (from keystore.properties) to the generated Android Gradle file.
// Used by CI after `tauri android init`. Usage: node scripts/android-signing.mjs <path to app/build.gradle.kts>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
let s = readFileSync(file, 'utf8');
if (s.includes('signingConfigs')) {
  console.log('Signing already configured.');
  process.exit(0);
}
if (!s.includes('import java.io.FileInputStream')) s = 'import java.io.FileInputStream\n' + s;
if (!s.includes('import java.util.Properties')) s = 'import java.util.Properties\n' + s;

const signing = `
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }`;

const androidBlock = s.indexOf('android {');
if (androidBlock < 0) throw new Error('No android { } block found');
s = s.slice(0, androidBlock + 'android {'.length) + signing + s.slice(androidBlock + 'android {'.length);

const release = s.indexOf('getByName("release") {');
if (release < 0) throw new Error('No release build type found');
s = s.slice(0, release + 'getByName("release") {'.length) + '\n            signingConfig = signingConfigs.getByName("release")' + s.slice(release + 'getByName("release") {'.length);

writeFileSync(file, s);
console.log('Release signing configured.');

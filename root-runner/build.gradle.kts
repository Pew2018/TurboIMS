plugins { id("com.android.application") }
android {
    namespace = "io.github.turboims.ksu"
    compileSdk = 37
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = "io.github.turboims.ksu.runner"
        minSdk = 33
        targetSdk = 37
        versionCode = 2
        versionName = "0.1.1"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    dependenciesInfo { includeInApk = false; includeInBundle = false }
}
dependencies {
    implementation("org.lsposed.hiddenapibypass:hiddenapibypass:6.1")
    testImplementation("junit:junit:4.13.2")
}

plugins { id("com.android.application") }
val runnerCompileSdk = providers.gradleProperty("androidCompileSdk").orElse("36").get().toInt()
val runnerBuildToolsVersion = providers.gradleProperty("androidBuildToolsVersion").orElse("36.0.0").get()

android {
    namespace = "io.github.turboims.ksu"
    compileSdk = runnerCompileSdk
    buildToolsVersion = runnerBuildToolsVersion
    defaultConfig {
        applicationId = "io.github.turboims.ksu.runner"
        minSdk = 33
        targetSdk = 36
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
    testImplementation("org.json:json:20240303")
}

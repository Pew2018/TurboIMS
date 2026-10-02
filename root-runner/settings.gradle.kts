pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    plugins { id("com.android.application") version "8.13.0" }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "TurboIMSRootRunner"

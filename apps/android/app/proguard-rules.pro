# kotlinx.serialization: keep generated serializers.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class app.openlinks.spendtracker.**$$serializer { *; }
-keepclassmembers class app.openlinks.spendtracker.** {
    *** Companion;
}
-keepclasseswithmembers class app.openlinks.spendtracker.** {
    kotlinx.serialization.KSerializer serializer(...);
}

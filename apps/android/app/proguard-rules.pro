# kotlinx.serialization: keep generated serializers.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-keep,includedescriptorclasses class com.openlinks.spendtracker.**$$serializer { *; }
-keepclassmembers class com.openlinks.spendtracker.** {
    *** Companion;
}
-keepclasseswithmembers class com.openlinks.spendtracker.** {
    kotlinx.serialization.KSerializer serializer(...);
}

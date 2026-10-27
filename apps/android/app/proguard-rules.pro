# kotlinx.serialization: keep the generated serializers of the API models.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.disbigle.kit.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.disbigle.kit.**$$serializer { *; }
-keepclasseswithmembers class com.disbigle.kit.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# OkHttp's optional TLS providers.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

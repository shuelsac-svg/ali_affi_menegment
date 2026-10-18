# AliExpress Affiliate Manager

האתר מורכב מממשק סטטי שמתפרסם ב־GitHub Pages ומ־Supabase לאימות, נתונים ו־Edge Function. מפתחות AliExpress נשמרים כשהם מוצפנים ב־Supabase; יצירת הקישור קורית רק בפונקציה בצד השרת.

## פריסה

1. צור פרויקט Supabase והריץ את `supabase/schema.sql` ב־SQL Editor.
2. התקן את Supabase CLI והתחבר פעם אחת: `supabase login`.
3. קבל את מזהה הפרויקט מכתובת Supabase, ואז הרץ `supabase link --project-ref מזהה-הפרויקט`.
4. צור מפתח הצפנה אקראי באורך 32 בייט. שמור אותו רק ב־Supabase Edge Function Secrets בשם `APP_ENCRYPTION_KEY`.
5. פרסם את הפונקציה: `supabase functions deploy affiliate-manager`.
6. ערוך את `app-config.js`: הוסף את Project URL, Publishable Key ואת כתובת הפונקציה `https://<project-ref>.supabase.co/functions/v1/affiliate-manager`. אלו ערכים ציבוריים; לעולם אל תוסיף App Secret או `service_role`/Secret Key לקובץ הזה.
7. צור מאגר GitHub **ציבורי** והעלה אליו את הפרויקט. ה־workflow שב־`.github/workflows/pages.yml` מפרסם את האתר. ב־GitHub פתח Settings > Pages וודא שמקור הפרסום הוא GitHub Actions.
8. אחרי שהאתר פורסם, הוסף את כתובתו ב־Supabase Authentication > URL Configuration כ־Site URL וגם כ־Redirect URL.
9. כדי לאפשר הרשמה במייל, הגדר כתובת SMTP משלך ב־Supabase. שרת המייל המובנה מיועד לבדיקה ומוגבל. אפשר להגדיר CAPTCHA ב־Supabase; אם עושים זאת, יש למלא גם `captchaSiteKey` ב־`app-config.js`.
10. בחלון הגדרות באתר, הזן את AppKey, App Secret ו־Tracking ID מחשבון AliExpress Affiliate.

המאגר הציבורי מכיל את קוד האתר, אך לא אמורים להיות בו מפתחות סודיים. בדוק את תכולתו לפני פרסום. Publishable Key הוא מפתח לקוח ציבורי; ההגנה על רשומות המשתמשים נאכפת באמצעות RLS ב־Supabase.

## יצירת קישורי אפילייט

הפונקציה קוראת למתודה הרשמית `aliexpress.affiliate.link.generate` דרך TOP, חותמת את הבקשה בצד השרת ומחזירה רק קישור שחזר מ־AliExpress. התיעוד הרשמי של המתודה מפרט AppKey, App Secret ו־Tracking ID. מדריך Affiliate API הכללי מסומן כמבוטל, לכן יש לאמת שהחשבון שלך קיבל גישה ל־API.

## מקורות רשמיים

- [Supabase Edge Functions: Deployment](https://supabase.com/docs/guides/functions/deploy)
- [Supabase Edge Functions: Secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase Authentication: SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [AliExpress Affiliate link.generate](https://developer.alibaba.com/docs/api.htm?apiId=45804)

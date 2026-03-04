import { useAuth0 } from "@auth0/auth0-react";
import { NotificationList } from "../components/NotificationList.js";

export function Profile() {
  const { user } = useAuth0();

  if (!user) return null;

  return (
    <div className="max-w-md mx-auto mt-8">
      <div className="text-center">
        {user.picture && (
          <img
            src={user.picture}
            alt={user.name}
            className="w-24 h-24 rounded-full mx-auto mb-4"
          />
        )}
        <h1 className="text-2xl font-bold mb-1">{user.name}</h1>
        <p className="text-gray-500 mb-8">{user.email}</p>
      </div>

      <NotificationList />

      <details className="text-left mt-8">
        <summary className="cursor-pointer text-gray-500 mb-2">
          Raw ID Token Claims
        </summary>
        <pre className="bg-gray-100 p-4 rounded text-xs overflow-x-auto">
          {JSON.stringify(user, null, 2)}
        </pre>
      </details>
    </div>
  );
}

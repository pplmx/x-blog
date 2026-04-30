/**
 * Admin login page tests
 * Tests the admin login form with validation and authentication
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock UI components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => (
    <div className={className} data-testid="card">
      {children}
    </div>
  ),
  CardHeader: ({ children, className }: any) => (
    <div className={className} data-testid="card-header">
      {children}
    </div>
  ),
  CardTitle: ({ children, className }: any) => (
    <h2 className={className} data-testid="card-title">
      {children}
    </h2>
  ),
  CardDescription: ({ children, className }: any) => (
    <p className={className} data-testid="card-description">
      {children}
    </p>
  ),
  CardContent: ({ children, className }: any) => (
    <div className={className} data-testid="card-content">
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, className, required, type, name }: any) => (
    <input
      type={type || 'text'}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      required={required}
      data-testid="input"
    />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, onClick, className, type }: any) => (
    <button
      disabled={disabled}
      onClick={onClick}
      className={className}
      type={type}
      data-testid="button"
    >
      {children}
    </button>
  ),
}));

// Mock the API
const mockAdminLogin = vi.fn();
vi.mock('@/lib/api', () => ({
  adminLogin: (username: string, password: string) => mockAdminLogin(username, password),
}));

// Mock auth context
const mockLogin = vi.fn();
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

// Mock data
const mockLoginResponse = {
  access_token: 'mock-token',
  token_type: 'bearer',
};

describe('Admin Login Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  describe('Form rendering', () => {
    it('renders login page title', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      expect(screen.getByText('X-Blog 管理')).toBeDefined();
    });

    it('renders login description', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      expect(screen.getByText('输入您的账号信息登录管理后台')).toBeDefined();
    });

    it('renders username input', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const usernameInput = screen.getByPlaceholderText('请输入用户名');
      expect(usernameInput).toBeDefined();
    });

    it('renders password input', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const passwordInput = screen.getByPlaceholderText('请输入密码');
      expect(passwordInput).toBeDefined();
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('renders login button', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const loginButton = screen.getByText('登录');
      expect(loginButton).toBeDefined();
    });

    it('renders back to blog link', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const backLink = screen.getByText('← 返回博客首页');
      expect(backLink).toBeDefined();
      expect(backLink.closest('a')).toHaveAttribute('href', '/');
    });
  });

  describe('Form functionality', () => {
    it('allows entering username', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });

      expect(usernameInput.value).toBe('admin');
    });

    it('allows entering password', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      expect(passwordInput.value).toBe('password123');
    });
  });

  describe('Login success', () => {
    it('calls adminLogin API on submit', async () => {
      mockAdminLogin.mockResolvedValue(mockLoginResponse);

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill in the form
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      // Submit the form
      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(mockAdminLogin).toHaveBeenCalledWith('admin', 'password123');
      });
    });

    it('calls login from auth context on success', async () => {
      mockAdminLogin.mockResolvedValue(mockLoginResponse);

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('mock-token');
      });
    });

    it('navigates to admin dashboard on success', async () => {
      mockAdminLogin.mockResolvedValue(mockLoginResponse);

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });
  });

  describe('Login failure', () => {
    it('shows error message on failed login', async () => {
      mockAdminLogin.mockRejectedValue(new Error('Invalid credentials'));

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('用户名或密码错误，请重试')).toBeDefined();
      });
    });

    it('does not navigate on failed login', async () => {
      mockAdminLogin.mockRejectedValue(new Error('Invalid credentials'));

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(mockPush).not.toHaveBeenCalled();
      });
    });

    it('clears previous error on new attempt', async () => {
      // First attempt fails
      mockAdminLogin
        .mockRejectedValueOnce(new Error('Invalid credentials'))
        // Second attempt succeeds
        .mockResolvedValueOnce(mockLoginResponse);

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // First failed attempt
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;

      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'wrong' } });
      let form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('用户名或密码错误，请重试')).toBeDefined();
      });

      // Second successful attempt
      fireEvent.change(passwordInput, { target: { value: 'correct' } });
      form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        // Error should be gone
        expect(screen.queryByText('用户名或密码错误，请重试')).toBeNull();
      });
    });
  });

  describe('Loading state', () => {
    it('disables button during login', async () => {
      mockAdminLogin.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'password' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        const button = screen.getByTestId('button') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
      });
    });

    it('shows loading text during login', async () => {
      mockAdminLogin.mockImplementation(() => new Promise(() => {}));

      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      // Fill and submit
      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'password' } });

      const form = document.querySelector('form');
      if (form) fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText('登录中...')).toBeDefined();
      });
    });
  });

  describe('Form validation', () => {
    it('has required attribute on username input', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const usernameInput = screen.getByPlaceholderText('请输入用户名') as HTMLInputElement;
      expect(usernameInput.required).toBe(true);
    });

    it('has required attribute on password input', async () => {
      const { default: LoginPage } = await import('./page');
      render(<LoginPage />);

      const passwordInput = screen.getByPlaceholderText('请输入密码') as HTMLInputElement;
      expect(passwordInput.required).toBe(true);
    });
  });
});
